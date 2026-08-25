import { CSSProperties, useRef, useState } from "react";
import { FixedSizeList } from "react-window";
import { ContextMenu, ContextMenuItem } from "../../components/ContextMenu";
import { useTreeUiStore } from "./useTreeUiStore";

/** Below this many (post-filter) items, the plain unvirtualized `<ul>` is cheap enough to just render outright — avoids giving small lists an arbitrary fixed-height scroll box for no benefit. */
const VIRTUALIZE_THRESHOLD = 50;
/** Must match `.resource-item`'s actual rendered height (padding included, via the global `box-sizing: border-box` reset) — react-window positions each row by this fixed pixel amount rather than measuring the DOM. */
const ROW_HEIGHT_PX = 32;
/** How many rows the virtualized viewport shows at once before scrolling — independent of how many items actually exist. */
const VISIBLE_ROWS = 10;

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
  /** Applied before matchesSearch/rendering — lets a call site narrow the list (e.g. hiding empty consumer groups) without this generic component knowing anything about what the filter means. */
  additionalFilter?: (item: T) => boolean;
  /** When given, right-clicking the category header opens a menu with these items instead of the browser's default context menu. */
  contextMenuItems?: ContextMenuItem[];
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
  additionalFilter,
  contextMenuItems,
}: ResourceCategoryProps<T>) {
  const expanded = useTreeUiStore((s) => s.expanded[key] ?? false);
  const toggleExpanded = useTreeUiStore((s) => s.toggleExpanded);
  const query = useTreeUiStore((s) => s.searchText[key] ?? "");
  const setSearchText = useTreeUiStore((s) => s.setSearchText);
  const hasExpandedBefore = useRef(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  function toggle() {
    if (!hasExpandedBefore.current) {
      hasExpandedBefore.current = true;
      onExpand();
    }
    toggleExpanded(key);
  }

  const filtered = (items ?? [])
    .filter((item) => (additionalFilter ? additionalFilter(item) : true))
    .filter((item) => matchesSearch(item, query));

  function renderItem(item: T, style?: CSSProperties) {
    return (
      <li
        key={getKey(item)}
        style={style}
        data-testid={`resource-item-${getKey(item)}`}
        className={`resource-item${isSelected(item) ? " resource-item--selected" : ""}`}
        onClick={() => onSelect(item)}
      >
        {getLabel(item)}
      </li>
    );
  }

  return (
    <li className="resource-category">
      <div
        className={`resource-category-header${expanded ? " resource-category-header--expanded" : ""}`}
        data-testid={`category-${label}`}
        onClick={toggle}
        onContextMenu={
          contextMenuItems
            ? (e) => {
                e.preventDefault();
                setMenuPosition({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
      >
        <span className="tree-caret" aria-hidden="true" />
        {label}
      </div>
      {menuPosition && contextMenuItems && (
        <ContextMenu x={menuPosition.x} y={menuPosition.y} items={contextMenuItems} onClose={() => setMenuPosition(null)} />
      )}
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
          {filtered.length > VIRTUALIZE_THRESHOLD ? (
            <FixedSizeList
              className="resource-item-list"
              innerElementType="ul"
              height={Math.min(filtered.length, VISIBLE_ROWS) * ROW_HEIGHT_PX}
              width="100%"
              itemCount={filtered.length}
              itemSize={ROW_HEIGHT_PX}
            >
              {({ index, style }) => renderItem(filtered[index], { ...style, marginBottom: 0 })}
            </FixedSizeList>
          ) : (
            <ul className="resource-item-list">{filtered.map((item) => renderItem(item))}</ul>
          )}
        </div>
      )}
    </li>
  );
}
