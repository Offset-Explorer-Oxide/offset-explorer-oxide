import { CSSProperties, useRef, useState } from "react";
import { FixedSizeList } from "react-window";
import { CategoryLoadWarning, CategoryWarningMarker } from "./CategoryLoadWarning";
import { ContextMenu, ContextMenuItem } from "../../components/ContextMenu";
import { ROW_HEIGHT_PX, useTreeListRows } from "./useTreeListHeight";
import { useTreeUiStore } from "./useTreeUiStore";

/** Below this many (post-filter) items, the plain unvirtualized `<ul>` is cheap enough to just render outright — avoids giving small lists an arbitrary fixed-height scroll box for no benefit. */
const VIRTUALIZE_THRESHOLD = 50;

export interface ResourceCategoryProps<T> {
  label: string;
  items: T[] | undefined;
  isLoading: boolean;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  matchesSearch: (item: T, query: string) => boolean;
  isSelected: (item: T) => boolean;
  onSelect: (item: T) => void;
  /** Called each time this category is opened (never on collapse) — refreshes its listing, which is otherwise fetched once and held. */
  onExpand: () => void;
  /** Tab-scoped key (see `treeKey`) this category's expand/search state is stored under, so it starts fresh for a new tab and stays exactly as left for one you've already visited. */
  treeKey: string;
  /** Applied before matchesSearch/rendering — lets a call site narrow the list (e.g. hiding empty consumer groups) without this generic component knowing anything about what the filter means. */
  additionalFilter?: (item: T) => boolean;
  /** When given, right-clicking the category header opens a menu with these items instead of the browser's default context menu. */
  contextMenuItems?: ContextMenuItem[];
  /**
   * The failure from this category's own listing query, if it failed.
   *
   * Each category is fetched independently, so one of them being refused
   * says nothing about the other two — a principal is routinely allowed to
   * read topics and brokers but not to list consumer groups, which needs
   * `Describe` on the `Group` resource. Reporting that here, on the one
   * category it applies to, keeps the rest of the cluster usable instead of
   * presenting the whole connection as broken.
   */
  error?: Error | null;
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
  error,
}: ResourceCategoryProps<T>) {
  const expanded = useTreeUiStore((s) => s.expanded[key] ?? false);
  const toggleExpanded = useTreeUiStore((s) => s.toggleExpanded);
  const query = useTreeUiStore((s) => s.searchText[key] ?? "");
  const setSearchText = useTreeUiStore((s) => s.setSearchText);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const visibleRows = useTreeListRows(bodyRef, expanded);

  function toggle() {
    // Every time the category is opened, not just the first time. The
    // listing behind it is fetched once and then held indefinitely (see
    // `CLUSTER_LISTING_OPTIONS`), so opening the category is the user's way
    // of saying "show me what's there now" — without this it would be the
    // only way to refresh, and it would work exactly once per session.
    // Collapsing is not a request for anything, so it doesn't fetch.
    if (!expanded) {
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
        {error && <CategoryWarningMarker label={label} error={error} />}
      </div>
      {menuPosition && contextMenuItems && (
        <ContextMenu x={menuPosition.x} y={menuPosition.y} items={contextMenuItems} onClose={() => setMenuPosition(null)} />
      )}
      {expanded && (
        <div className="resource-category-body" ref={bodyRef}>
          {/* Sticky, like the category header and cluster row above it: with
              a few hundred topics the search box is the one control the user
              needs *while* scrolling the list it filters. */}
          <div className="resource-category-search-row">
            <input
              className="resource-category-search"
              aria-label={`Search ${label}`}
              placeholder={`Search ${label.toLowerCase()}…`}
              value={query}
              onChange={(e) => setSearchText(key, e.target.value)}
            />
          </div>
          {error && <CategoryLoadWarning label={label} error={error} />}
          {isLoading && <p>Loading…</p>}
          {filtered.length > VIRTUALIZE_THRESHOLD ? (
            <FixedSizeList
              className="resource-item-list"
              innerElementType="ul"
              height={Math.min(filtered.length, visibleRows) * ROW_HEIGHT_PX}
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
