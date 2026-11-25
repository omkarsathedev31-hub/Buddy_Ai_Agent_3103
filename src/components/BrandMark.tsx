export function BrandMark({ className = 'w-9 h-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M20 3L6 8.5V19.2C6 27.9 12 35.1 20 37.5C28 35.1 34 27.9 34 19.2V8.5L20 3Z"
        className="fill-[#0F5156] dark:fill-teal-600"
      />
      <path
        d="M12.5 22.5C12.5 18.3579 15.8579 15 20 15C24.1421 15 27.5 18.3579 27.5 22.5"
        stroke="#FAF8F5"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M16.5 22.5C16.5 20.567 18.067 19 20 19C21.933 19 23.5 20.567 23.5 22.5"
        stroke="#F29F67"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M11 26H29"
        stroke="#FAF8F5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
