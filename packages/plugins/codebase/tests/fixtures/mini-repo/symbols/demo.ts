import { updateCloudClient, HelperRegistry } from '../../src/utils/helper'

export interface Shape {
  area(): number
}

export class Circle extends HelperRegistry implements Shape {
  readonly radius: number = 1

  handleClick = () => {
    updateCloudClient('clicked')
  }

  area(): number {
    return 3
  }
}

export enum Color {
  Red,
  Green,
}

export type Alias = string

export const answer = 42

export function render(): void {
  updateCloudClient('demo')
}
