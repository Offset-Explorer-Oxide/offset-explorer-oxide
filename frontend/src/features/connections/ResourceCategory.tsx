import { useRef, useState } from "react";

export interface ResourceCategoryProps<T> {
  label: string;
  items: T[] | undefined;
  isLoading: boolean;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  matchesSearch: (item: T, query: string) => boolean;
  isSelected: (item: T) => boolean;
  onSelect: (item: T) => void;
  /** Called exactly once, the first time this category is expanded — triggers the lazy fetch. */
  onExpand: () => void;
}

/**
 * One expandable, searchable, lazily-loaded sub-list in the tree (Brokers,
 * Topics, or Consumers under a connected cluster). Generic over the item
 * type so the same component backs all three.
 */
export function ResourceCategory<T>({
  label,
  items,
  isLoading,
  getKey,
  getLabel,
  matchesSearch,
  isSelected,
  onSelect,
  onExpand,
}: ResourceCategoryProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const hasExpandedBefore = useRef(false);

  function toggle() {
    if (!hasExpandedBefore.current) {
      hasExpandedBefore.current = true;
      onExpand();
    }
    setExpanded((current) => !current);
  }

  const filtered = (items ?? []).filter((item) => matchesSearch(item, query));

  return (
    <li className="resource-category">
      <div
        className={`resource-category-header${expanded ? " resource-category-header--expanded" : ""}`}
        data-testid={`category-${label}`}
        onClick={toggle}
      >
        <span className="tree-caret" aria-hidden="true" />
        {label}
      </div>
      {expanded && (
        <div className="resource-category-body">
          <input
            className="resource-category-search"
            aria-label={`Search ${label}`}
            placeholder={`Search ${label.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isLoading && <p>Loading…</p>}
          <ul className="resource-item-list">
            {filtered.map((item) => (
              <li
                key={getKey(item)}
                data-testid={`resource-item-${getKey(item)}`}
                className={`resource-item${isSelected(item) ? " resource-item--selected" : ""}`}
                onClick={() => onSelect(item)}
              >
                {getLabel(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
