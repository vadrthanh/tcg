import { useEffect, useMemo, useRef, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import type { CardRow } from "../lib/types";
import { CardArt } from "./ui/CardArt";

// Decorative fallback so the hero still animates before the backend responds
// (or when it's offline). Real cards replace these as soon as /api/cards loads.
const PLACEHOLDERS: CardRow[] = ["Dragon", "Fire", "Water", "Grass", "Psychic", "Electric"].map((t, i) => ({
  id: -(i + 1), name: "", rarity: i % 2 ? "Rare" : "UltraRare", pokemonType: t, hp: 0,
  attack: "", maxSupply: 0, currentSupply: 0, floorPrice: "0", imageURI: "", createdAt: "",
}));

/**
 * Auto-scrolling card strip (left → right). The user can drag/flick or wheel
 * over it to speed it up; momentum (inertia) carries, then eases back to the
 * gentle baseline drift. rAF-driven so the user input and the auto-scroll share
 * one velocity — a CSS animation can't do that.
 */
export function HeroCarousel({ cards, onClick }: { cards: CardRow[]; onClick?: () => void }) {
  const list = cards.length >= 4 ? cards : PLACEHOLDERS;
  // Duplicate the list so wrapping the offset by one copy's width loops seamlessly.
  const loop = useMemo(() => [...list, ...list], [list]);
  const trackRef = useRef<HTMLDivElement>(null);
  const st = useRef({ offset: 0, vel: 0, half: 0, dragging: false, lastX: 0, moved: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const s = st.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const BASE = reduce ? 0 : 0.35;       // baseline drift, px/frame
    const RETURN = 0.03;                  // how fast velocity eases back to BASE (lower = longer glide)

    // Width of exactly one copy of the list (incl. each card's right margin) =
    // the period after which the strip repeats.
    const measure = () => {
      const kids = Array.from(track.children) as HTMLElement[];
      const n = kids.length / 2;
      let w = 0;
      for (let i = 0; i < n; i++) w += kids[i].offsetWidth + parseFloat(getComputedStyle(kids[i]).marginRight || "0");
      s.half = w;
      if (s.offset === 0 && w > 0) s.offset = -w; // start one copy in so content fills both sides
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);

    let raf = 0;
    const tick = () => {
      if (!s.dragging) { s.vel += (BASE - s.vel) * RETURN; s.offset += s.vel; }
      if (s.half > 0) {
        if (s.offset >= 0) s.offset -= s.half;
        else if (s.offset < -s.half) s.offset += s.half;
      }
      track.style.transform = `translate3d(${s.offset}px,0,0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [loop]);

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    const s = st.current;
    s.dragging = true; s.lastX = e.clientX; s.moved = false; s.vel = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: RPointerEvent<HTMLDivElement>) {
    const s = st.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    s.lastX = e.clientX;
    if (Math.abs(dx) > 2) s.moved = true;
    s.offset += dx;
    s.vel = dx;                            // last drag delta becomes the release velocity → inertia
  }
  function endDrag() { st.current.dragging = false; }
  function onWheel(e: RWheelEvent<HTMLDivElement>) {
    const s = st.current;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    s.vel = Math.max(-90, Math.min(90, s.vel + d * 0.3));
  }
  // Suppress the click that follows a drag so a flick doesn't navigate.
  function cardClick() { if (!st.current.moved) onClick?.(); }

  return (
    <div className="hero-carousel"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={onWheel}>
      <div className="hero-carousel-track" ref={trackRef}>
        {loop.map((c, i) => (
          <button key={i} className="hero-carousel-card" tabIndex={-1} onClick={cardClick}
            aria-label={c.name || "Pokémon card"}>
            <CardArt card={c} size="lg" />
          </button>
        ))}
      </div>
    </div>
  );
}
