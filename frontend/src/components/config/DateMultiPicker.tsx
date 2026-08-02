import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { parseISO, format } from "date-fns";

interface Props {
  available: string[];   // ISO YYYY-MM-DD
  selected: string[];    // ISO
  onChange: (next: string[]) => void;
}

export function DateMultiPicker({ available, selected, onChange }: Props) {
  const availDates = available.map((d) => parseISO(d));
  const selDates = selected.map((d) => parseISO(d));
  const allowedSet = new Set(available);

  if (available.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--grey-5)" }}>
        No dates known for this upload yet — scan the file on the Upload page.
      </div>
    );
  }

  const min = availDates.reduce((a, b) => (a < b ? a : b));
  const max = availDates.reduce((a, b) => (a > b ? a : b));

  return (
    <DayPicker
      mode="multiple"
      selected={selDates}
      disabled={(d) => !allowedSet.has(format(d, "yyyy-MM-dd"))}
      startMonth={min}
      endMonth={max}
      defaultMonth={min}
      onSelect={(days) => {
        const iso = (days ?? []).map((d) => format(d, "yyyy-MM-dd"));
        onChange(iso.sort());
      }}
    />
  );
}
