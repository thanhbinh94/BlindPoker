export declare function hexToHsl(hex: string): [number, number, number]
export declare function meanLightness(pixels: ArrayLike<number>, mask: ArrayLike<number>): number
export declare function shade(pixels: Uint8ClampedArray | Uint8Array, mask: ArrayLike<number>, colour: string, meanL: number): void
export declare function recolour(pixels: Uint8ClampedArray | Uint8Array, mask: ArrayLike<number>, colour: string, meanL: number): void
