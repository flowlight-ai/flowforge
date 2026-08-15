// 放在 packages/core/tools/tests/ 下临时验证自引用解析
import { jsonSchemaToPy } from '@flowforge/tools/src/py-types.ts'
console.log('SELF-REF OK, jsonSchemaToPy type:', typeof jsonSchemaToPy)
