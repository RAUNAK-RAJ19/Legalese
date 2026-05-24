declare module 'react' {
  export type ChangeEvent<T = any> = {
    target: T;
  };

  export type RefObject<T> = {
    current: T | null;
  };

  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useRef<T>(initialValue: T | null): RefObject<T>;
  export function useState<T>(initialValue: T): [T, (value: T | ((previous: T) => T)) => void];

  export const StrictMode: any;
}

declare module 'react-dom/client' {
  export function createRoot(container: HTMLElement): { render(node: any): void };
}

declare module 'framer-motion' {
  export const AnimatePresence: any;
  export const motion: any;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}