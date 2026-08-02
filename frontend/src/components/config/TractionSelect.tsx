import { CheckCircle2, XCircle } from "lucide-react";
import { TRACTION_CLASSES } from "../../constants/tractionClasses";

interface Props {
  value: string;                  // c0..c9
  onChange: (id: string) => void;
}

export function TractionSelect({ value, onChange }: Props) {
  return (
    <div className="class-list">
      {TRACTION_CLASSES.map((c) => (
        <div key={c.id}
             className={"class-row" + (c.id === value ? " selected" : "")}
             onClick={() => c.hasSrtProfile && onChange(c.id)}
             style={{
               opacity: c.hasSrtProfile ? 1 : 0.55,
               cursor: c.hasSrtProfile ? "pointer" : "not-allowed",
             }}>
          <div className="digit">{c.digit}</div>
          <div>
            <div className="name">{c.name}</div>
            <div className="desc">{c.description}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column",
                        alignItems: "flex-end", gap: 4 }}>
            <span className={"badge " + c.category}>{c.category}</span>
            <span style={{ fontSize: 11, color: "var(--grey-5)" }}>
              ~{c.mphTypical} mph
            </span>
            {c.hasSrtProfile ? (
              <span style={{ display: "inline-flex", alignItems: "center",
                             gap: 3, fontSize: 11, color: "var(--success)" }}>
                <CheckCircle2 size={11} /> SRT ready
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center",
                             gap: 3, fontSize: 11, color: "var(--grey-4)" }}>
                <XCircle size={11} /> no SRT
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
