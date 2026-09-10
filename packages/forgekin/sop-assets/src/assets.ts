import type { SopAsset } from './sop-asset-model.ts'
import { isSopAssetValid } from './validate-sop-asset.ts'

/**
 * In-memory registry of validated SOP content assets, keyed by id. Registration
 * rejects invalid assets and duplicate ids.
 */
export interface ISopAssetRegistry {
  register(asset: SopAsset): void
  has(id: string): boolean
  get(id: string): SopAsset | undefined
  all(): SopAsset[]
}

export class MemorySopAssetRegistry implements ISopAssetRegistry {
  private assets = new Map<string, SopAsset>()

  register(asset: SopAsset): void {
    if (this.assets.has(asset.id)) {
      throw new Error(`duplicate sop asset id "${asset.id}"`)
    }
    if (!isSopAssetValid(asset)) {
      throw new Error(`refusing to register invalid sop asset "${asset.id}"`)
    }
    this.assets.set(asset.id, cloneAsset(asset))
  }

  has(id: string): boolean {
    return this.assets.has(id)
  }

  get(id: string): SopAsset | undefined {
    const asset = this.assets.get(id)
    return asset ? cloneAsset(asset) : undefined
  }

  all(): SopAsset[] {
    return Array.from(this.assets.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(cloneAsset)
  }
}

function cloneAsset(asset: SopAsset): SopAsset {
  return JSON.parse(JSON.stringify(asset)) as SopAsset
}