export interface FieldHandsetSize {
  width: number;
  height: number;
}

export const FIELD_HANDSET_SIZES: FieldHandsetSize[] = [
  { width: 390, height: 780 },
  { width: 412, height: 740 },
  { width: 360, height: 640 },
];

export function readFieldHandsetSize(): FieldHandsetSize {
  const stored = window.localStorage.getItem("rig.field.size");
  return FIELD_HANDSET_SIZES.find(({ width, height }) => stored === `${width}x${height}`)
    ?? FIELD_HANDSET_SIZES[0]!;
}

export function FieldSizePicker({
  value,
  onChange,
}: {
  value: FieldHandsetSize;
  onChange: (size: FieldHandsetSize) => void;
}) {
  return (
    <div className="fsize-picker">
      <span>HANDSET</span>
      <div role="group" aria-label="Field handset size">
        {FIELD_HANDSET_SIZES.map((size) => {
          const active = size.width === value.width && size.height === value.height;
          return (
            <button
              type="button"
              key={`${size.width}x${size.height}`}
              className={active ? "is-active" : undefined}
              aria-pressed={active}
              onClick={() => {
                window.localStorage.setItem("rig.field.size", `${size.width}x${size.height}`);
                onChange(size);
              }}
            >
              {size.width} × {size.height}
            </button>
          );
        })}
      </div>
    </div>
  );
}
