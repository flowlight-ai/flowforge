/**
 * JSON Schema → Zod converter
 *
 * Turns plain JSON Schema tool definitions into Zod schemas at registration
 * time so the MCP SDK can serialize the tool's input schema for listing and
 * validate incoming call arguments.
 *
 * NOTE: this module is zod-v4 compatible. Zod v4 keeps `z.enum(tuple)`,
 * `z.object(shape)`, `z.record(key, value)` (two-arg) and `.describe()`, all
 * of which are used below.
 */

import { z } from 'zod';

function jsonPropertyToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const propType = prop.type as string | undefined;
  let schema: z.ZodTypeAny;

  switch (propType) {
    case 'string':
      if (Array.isArray(prop.enum) && prop.enum.length > 0) {
        schema = z.enum(prop.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case 'number':
    case 'integer':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(
        prop.items && typeof prop.items === 'object'
          ? jsonPropertyToZod(prop.items as Record<string, unknown>)
          : z.unknown(),
      );
      break;
    case 'object':
      schema = z.record(z.string(), z.unknown());
      break;
    default:
      schema = z.unknown();
  }

  if (typeof prop.description === 'string') {
    schema = schema.describe(prop.description);
  }

  return schema;
}

/**
 * Convert a plain JSON Schema object to a Zod object schema.
 *
 * Handles the subset of JSON Schema used by tool definitions:
 *   { type: 'object', properties: {...}, required?: [...] }
 */
export function jsonSchemaToZod(jsonSchema: Record<string, unknown>): z.ZodObject<z.ZodRawShape> {
  const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) {
    return z.object({});
  }

  const requiredSet = new Set(Array.isArray(jsonSchema.required) ? (jsonSchema.required as string[]) : []);

  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(properties)) {
    const zodProp = jsonPropertyToZod(prop);
    shape[key] = requiredSet.has(key) ? zodProp : zodProp.optional();
  }

  return z.object(shape as z.ZodRawShape);
}