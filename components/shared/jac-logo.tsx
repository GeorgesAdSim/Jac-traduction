export function JACLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      width="64"
      height="28"
      viewBox="0 0 64 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="64" height="28" rx="4" fill="#e60012" />
      <text
        x="32"
        y="19"
        textAnchor="middle"
        fill="white"
        fontFamily="Inter, sans-serif"
        fontWeight="700"
        fontSize="14"
      >
        JAC
      </text>
    </svg>
  );
}
