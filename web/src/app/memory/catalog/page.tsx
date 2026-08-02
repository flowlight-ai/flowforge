"use client";

/**
 * /memory/catalog — 集合目录
 */

import { MemoryHub } from "@/components/memory";
import { CollectionCatalog } from "@/components/memory/CollectionCatalog";

export default function MemoryCatalogPage() {
  return (
    <MemoryHub activeTab="catalog">
      <CollectionCatalog />
    </MemoryHub>
  );
}
