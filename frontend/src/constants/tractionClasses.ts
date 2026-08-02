export interface TractionClass {
  id: string;               // c0 c1 ... c9
  digit: number;
  name: string;
  category: "passenger" | "freight" | "empty" | "other";
  description: string;
  hasSrtProfile: boolean;   // whether the MILP has an SRT profile for it
  mphTypical: number;       // reference speed
}

export const TRACTION_CLASSES: TractionClass[] = [
  { id: "c0", digit: 0, name: "Class 0 — Light locomotive",
    category: "other",
    description: "Light engine, on-track machine, empty stock movement.",
    hasSrtProfile: false, mphTypical: 50 },
  { id: "c1", digit: 1, name: "Class 1 — Express passenger",
    category: "passenger",
    description: "InterCity / TransPennine / long-distance express services.",
    hasSrtProfile: false, mphTypical: 110 },
  { id: "c2", digit: 2, name: "Class 2 — Ordinary / stopping passenger",
    category: "passenger",
    description: "Local and regional stopping passenger services.",
    hasSrtProfile: false, mphTypical: 75 },
  { id: "c3", digit: 3, name: "Class 3 — Empty coaching stock / parcels",
    category: "empty",
    description: "ECS moves, parcels, non-revenue passenger stock.",
    hasSrtProfile: false, mphTypical: 75 },
  { id: "c4", digit: 4, name: "Class 4 — Freight 75 mph",
    category: "freight",
    description: "Fully fitted intermodal / container freight, 75 mph.",
    hasSrtProfile: true, mphTypical: 75 },
  { id: "c5", digit: 5, name: "Class 5 — Empty freight",
    category: "empty",
    description: "Empty coaching stock and empty freight consists.",
    hasSrtProfile: false, mphTypical: 60 },
  { id: "c6", digit: 6, name: "Class 6 — Freight 60 mph (heavy)",
    category: "freight",
    description:
      "Fitted heavy freight, Class 66/1400 t. Worst-case timing profile.",
    hasSrtProfile: true, mphTypical: 60 },
  { id: "c7", digit: 7, name: "Class 7 — Freight 45 mph",
    category: "freight",
    description: "Fully fitted freight, 45 mph, lower priority than Class 6.",
    hasSrtProfile: false, mphTypical: 45 },
  { id: "c8", digit: 8, name: "Class 8 — Freight 35 mph unfitted",
    category: "freight",
    description: "Unfitted / partly fitted freight, 35 mph.",
    hasSrtProfile: false, mphTypical: 35 },
  { id: "c9", digit: 9, name: "Class 9 — Charter / special passenger",
    category: "passenger",
    description: "Charter passenger, test, or specially authorised services.",
    hasSrtProfile: false, mphTypical: 75 },
];
