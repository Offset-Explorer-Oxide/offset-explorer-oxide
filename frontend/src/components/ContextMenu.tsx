import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  /** Styles the item in the "danger" color (e.g. a delete action). */
  destructive?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** A small floating menu positioned at a fixed viewport point (a right-click's clientX/clientY), closing itself on outside click, Escape, or item selection. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <ul className="context-menu" role="menu" ref={menuRef} style={{ top: y, left: x }}>
      {items.map((item) => (
        <li
          key={item.label}
          role="menuitem"
          aria-disabled={item.disabled}
          className={`context-menu-item${item.destructive ? " context-menu-item--destructive" : ""}`}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
