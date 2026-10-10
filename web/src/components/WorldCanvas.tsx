import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { World, WorldState } from '../world';

/**
 * The live archipelago behind the whole page. Three.js loads as a separate chunk after the first
 * paint; without WebGL the page keeps a static gradient instead. `pickRef` lets the page ask which
 * island is under a click.
 */
export function WorldCanvas({ state, pickRef }: { state: WorldState; pickRef?: MutableRefObject<((x: number, y: number) => string | null) | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const latest = useRef(state);
  const [ready, setReady] = useState(false);
  latest.current = state;

  useEffect(() => {
    let disposed = false;
    import('../world')
      .then(({ World: WorldClass, webglAvailable }) => {
        if (disposed || !canvas.current || !webglAvailable()) return;
        world.current = new WorldClass(canvas.current);
        world.current.setState(latest.current);
        if (pickRef) pickRef.current = (x, y) => world.current?.pick(x, y) ?? null;
        requestAnimationFrame(() => !disposed && setReady(true));
      })
      .catch((err: unknown) => console.warn('A 3D világ nem tölthető be:', err));
    return () => {
      disposed = true;
      world.current?.dispose();
      world.current = null;
      if (pickRef) pickRef.current = null;
    };
  }, [pickRef]);

  useEffect(() => {
    world.current?.setState(state);
  }, [state]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(120%_80%_at_70%_30%,#1a2433_0%,#0b0c0e_70%)]" aria-hidden>
      <canvas ref={canvas} className={`h-full w-full transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'}`} />
      {/* Scrims keep the copy readable over a bright daytime sky. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(11_12_14/0.82)_0%,rgb(11_12_14/0.45)_34%,transparent_58%)] max-lg:bg-[linear-gradient(180deg,transparent_0%,transparent_30%,rgb(11_12_14/0.75)_70%)]" />
      <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgb(11_12_14/0.6),transparent)]" />
    </div>
  );
}
