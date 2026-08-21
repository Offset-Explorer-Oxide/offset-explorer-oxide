import { useRef } from "react";
import { useTreeUiStore } from "./useTreeUiStore";

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
  /** Tab-scoped key (see `treeKey`) this category's expand/search state is stored under, so it starts fresh for a new tab and stays exactly as left for one you've already visited. */
  treeKey: string;
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
  treeKey: key,
}: ResourceCategoryProps<T>) {
  const expanded = useTreeUiStore((s) => s.expanded[key] ?? false);
  const toggleExpanded = useTreeUiStore((s) => s.toggleExpanded);
  const query = useTreeUiStore((s) => s.searchText[key] ?? "");
  const setSearchText = useTreeUiStore((s) => s.setSearchText);
  const hasExpandedBefore = useRef(false);

  function toggle() {
    if (!hasExpandedBefore.current) {
      hasExpandedBefore.current = true;
      onExpand();
    }
    toggleExpanded(key);
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
            onChange={(e) => setSearchText(key, e.target.value)}
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
