// One choice in a Picker or a Segmented control: what it saves, and what it shows.
export interface Choice<Value extends string> {
  value: Value;
  label: string;
}
