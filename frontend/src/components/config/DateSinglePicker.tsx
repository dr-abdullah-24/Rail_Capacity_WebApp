import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { parseISO, format } from "date-fns";
import { CalendarRange, X } from "lucide-react";

interface Props {
  available: string[];              // ISO YYYY-MM-DD
  value: string;                    // "" = all dates
  onChange: (next: string) => void;
}

export function DateSinglePicker({ available, value, onChange }: Props) {
  const availDates = available.map((d) => parseISO(d));
  const allowedSet = new Set(available);
  const selDate    = value && allowedSet.has(value) ? parseISO(value) : undefined;
  const allMode    = !value;   // blank = "all dates selected"

  if (available.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--grey-6)",
                    padding: "10px 12px",
                    border: "1px dashed var(--border)",
                    borderRadius: 8, background: "var(--paper)" }}>
        No dates known for the selected uploads yet — scan them on the
        Upload page to enable date filtering.
      </div>
    );
  }

  const min = availDates.reduce((a, b) => (a < b ? a : b));
  const max = availDates.reduce((a, b) => (a > b ? a : b));

  return (
    <div style={{ border: `1.5px solid ${allMode ? "var(--steel)" : "var(--border)"}`,
                   borderRadius: 8, background: "#fff",
                   padding: 8,
                   boxShadow: allMode
                     ? "0 0 0 3px rgba(61,90,128,0.10)"
                     : "none",
                   transition: "border-color 120ms, box-shadow 120ms" }}>
      <div style={{ display: "flex", alignItems: "center",
                     justifyContent: "space-between",
                     gap: 8, marginBottom: 6,
                     paddingLeft: 4 }}>
        <div style={{ fontSize: 11, color: allMode ? "var(--steel)" : "var(--grey-6)",
                       display: "flex", alignItems: "center", gap: 6,
                       fontWeight: allMode ? 600 : 400 }}>
          <CalendarRange size={12} />
          {allMode
            ? `all ${available.length} date${available.length === 1 ? "" : "s"} selected`
            : `${available.length} date${available.length === 1 ? "" : "s"} available`}
        </div>
        <button type="button" className="secondary"
                onClick={() => onChange("")}
                style={{ padding: "3px 10px", fontSize: 11,
                          minHeight: 0, height: 24 }}
                disabled={allMode}>
          <X size={12} /> All dates
        </button>
      </div>
      <DayPicker
        mode="single"
        selected={selDate}
        /* When in all-mode, highlight every available date as if selected */
        modifiers={{ allSelected: allMode ? availDates : [] }}
        modifiersStyles={{
          allSelected: {
            backgroundColor: "rgba(61,90,128,0.15)",
            borderRadius: "50%",
            fontWeight: 700,
            color: "var(--steel)",
          },
        }}
        disabled={(d) => !allowedSet.has(format(d, "yyyy-MM-dd"))}
        startMonth={min}
        endMonth={max}
        defaultMonth={selDate ?? min}
        onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
      />
    </div>
  );
}
