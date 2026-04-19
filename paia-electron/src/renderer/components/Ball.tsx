// The floating ball. Tiny presentational component — App.tsx owns the
// click handler that switches view to the panel.

interface BallProps {
  onClick: () => void;
}

export function Ball({ onClick }: BallProps) {
  return (
    <div className="ball" onClick={onClick} title="PAiA — click to open">
      <div className="ball-core" />
      <div className="ball-pulse" />
    </div>
  );
}
