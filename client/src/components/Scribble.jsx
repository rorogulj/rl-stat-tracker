/** Neon cursive accent (Condiment) — purely decorative, max 1 per page. */
export default function Scribble({ children, small, style }) {
  return (
    <span className={small ? 'scribble sm' : 'scribble'} style={style} aria-hidden="true">
      {children}
    </span>
  );
}
