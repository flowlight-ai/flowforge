export function updateCloudClient(client: string): string {
  return client
}

export class HelperRegistry {
  private readonly items = new Map<string, string>()

  register(key: string, value: string): void {
    this.items.set(key, value)
  }
}
