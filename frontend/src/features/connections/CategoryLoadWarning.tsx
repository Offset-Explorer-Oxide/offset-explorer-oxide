/**
 * How the tree reports a sub-list that could not be loaded.
 *
 * Brokers, Topics and Consumers are three independent requests against the
 * cluster, and the broker answers each against its own ACLs — listing
 * consumer groups needs `Describe` on the `Group` resource, which a
 * principal with full read access to every topic is routinely not granted.
 * So one category failing is not evidence that the connection is broken,
 * and must not be presented as though it were: the failure is reported on
 * the category it belongs to, and the rest of the cluster stays usable.
 *
 * Shared by `ResourceCategory` and `TopicCategory`, which are otherwise
 * separate components (topic rows expand to their partitions; broker and
 * consumer rows don't).
 */
export interface CategoryLoadWarningProps {
  /** The category's display name, e.g. "Consumers". */
  label: string;
  error: Error;
}

/**
 * Sits in the category header, so a failure is visible without expanding —
 * a category that was refused and one that is genuinely empty otherwise
 * look identical in a collapsed tree.
 */
export function CategoryWarningMarker({ label, error }: CategoryLoadWarningProps) {
  return (
    <span
      className="resource-category-warning-marker"
      data-testid={`category-${label}-warning`}
      title={`${label} could not be loaded: ${error.message}`}
      aria-label={`${label} could not be loaded`}
    >
      !
    </span>
  );
}

/** The full explanation, shown inside the category once it's expanded. */
export function CategoryLoadWarning({ label, error }: CategoryLoadWarningProps) {
  return (
    <p className="resource-category-warning" role="status">
      {label} could not be loaded. {error.message}
      <br />
      This is limited to {label.toLowerCase()}; the rest of the cluster is unaffected.
    </p>
  );
}
