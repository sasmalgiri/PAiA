// Minimal ambient typing for smiles-drawer. The package ships without
// declarations; we model only the surface we actually use in markdown.ts.
declare module 'smiles-drawer' {
  interface DrawerOptions {
    width?: number;
    height?: number;
    bondThickness?: number;
    bondLength?: number;
    shortBondLength?: number;
    [key: string]: unknown;
  }
  export class Drawer {
    constructor(options?: DrawerOptions);
    draw(tree: unknown, target: string | HTMLCanvasElement, theme?: string, infoOnly?: boolean): void;
  }
  export class SvgDrawer {
    constructor(options?: DrawerOptions);
    draw(tree: unknown, target: SVGSVGElement | string, theme?: string, infoOnly?: boolean): void;
  }
  export function parse(
    smiles: string,
    success?: (tree: unknown) => void,
    error?: (err: unknown) => void,
  ): unknown;
  export function clean(smiles: string): string;
  const _default: {
    Drawer: typeof Drawer;
    SvgDrawer: typeof SvgDrawer;
    parse: typeof parse;
    clean: typeof clean;
  };
  export default _default;
}
