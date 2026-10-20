import {
  createContext,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Collapsible,
  Select as RadixSelect,
  Slider as RadixSlider,
  Tooltip as RadixTooltip,
} from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/20/solid";

export function Button({
  variant = "secondary",
  active,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`button button--${variant} ${active ? "is-active" : ""} ${className}`}
      {...props}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}
const systemDefault = "__system_default__";
export function Select({
  id,
  label,
  value,
  options,
  onValueChange,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <RadixSelect.Root
        value={value || systemDefault}
        onValueChange={(next) => onValueChange(next === systemDefault ? "" : next)}
        disabled={disabled}
      >
        <RadixSelect.Trigger id={id} className="select-trigger" aria-describedby={describedBy}>
          <RadixSelect.Value />
          <RadixSelect.Icon>
            <ChevronDownIcon />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            className="select-content"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <RadixSelect.Viewport className="select-viewport">
              {options.map((option) => (
                <RadixSelect.Item
                  className="select-item"
                  key={option.value}
                  value={option.value || systemDefault}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <CheckIcon />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}

export function Slider({
  id,
  label,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <div className="field volume-field">
      <div className="volume-label">
        <label htmlFor={id}>{label}</label>
        <output>{Math.round(value * 100)}%</output>
      </div>
      <RadixSlider.Root
        id={id}
        className="slider"
        value={[value]}
        min={0}
        max={1}
        step={0.01}
        onValueChange={(values) => onValueChange(values[0])}
      >
        <RadixSlider.Track className="slider-track">
          <RadixSlider.Range className="slider-range" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="slider-thumb" aria-label={label} />
      </RadixSlider.Root>
    </div>
  );
}

export const TooltipProvider = RadixTooltip.Provider;
export const TooltipContainer = createContext<HTMLElement | null>(null);
export function Tooltip({ children, content }: { children: ReactNode; content: string }) {
  const container = useContext(TooltipContainer);
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal container={container}>
        <RadixTooltip.Content className="tooltip" sideOffset={8}>
          {content}
          <RadixTooltip.Arrow className="tooltip-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function Disclosure({
  title,
  children,
  id,
}: {
  title: ReactNode;
  children: ReactNode;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="disclosure" id={id}>
      <Collapsible.Trigger className="disclosure-trigger">
        <ChevronDownIcon />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Content forceMount hidden={!open} className="disclosure-content">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
