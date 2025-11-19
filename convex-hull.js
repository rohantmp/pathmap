/**
 * Compute the convex hull of a set of points using Graham's scan algorithm
 * @param {Array<{lat: number, lon: number}>} points - Array of coordinates
 * @returns {Array<{lat: number, lon: number}>} Convex hull vertices in counter-clockwise order
 */
export function computeConvexHull(points) {
    if (points.length < 3) {
        return points;
    }

    // Create a copy to avoid modifying the original array
    const pts = [...points];

    // Find the point with the lowest latitude (and leftmost if tie)
    let pivot = pts[0];
    let pivotIndex = 0;

    for (let i = 1; i < pts.length; i++) {
        if (pts[i].lat < pivot.lat || (pts[i].lat === pivot.lat && pts[i].lon < pivot.lon)) {
            pivot = pts[i];
            pivotIndex = i;
        }
    }

    // Move pivot to the beginning
    [pts[0], pts[pivotIndex]] = [pts[pivotIndex], pts[0]];

    // Sort points by polar angle with respect to pivot
    const sorted = [pts[0]];
    const rest = pts.slice(1).sort((a, b) => {
        const angleA = Math.atan2(a.lat - pivot.lat, a.lon - pivot.lon);
        const angleB = Math.atan2(b.lat - pivot.lat, b.lon - pivot.lon);

        if (angleA !== angleB) {
            return angleA - angleB;
        }

        // If angles are equal, sort by distance
        const distA = distanceSquared(pivot, a);
        const distB = distanceSquared(pivot, b);
        return distA - distB;
    });

    sorted.push(...rest);

    // Remove duplicate points at the same location
    const unique = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].lat !== sorted[i - 1].lat || sorted[i].lon !== sorted[i - 1].lon) {
            unique.push(sorted[i]);
        }
    }

    if (unique.length < 3) {
        return unique;
    }

    // Build convex hull
    const hull = [unique[0], unique[1]];

    for (let i = 2; i < unique.length; i++) {
        // Remove points that make a clockwise turn
        while (hull.length >= 2 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], unique[i]) <= 0) {
            hull.pop();
        }
        hull.push(unique[i]);
    }

    return hull;
}

/**
 * Calculate cross product to determine turn direction
 * @returns {number} Positive if counter-clockwise, negative if clockwise, 0 if collinear
 */
function crossProduct(o, a, b) {
    return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
}

/**
 * Calculate squared distance between two points (avoids sqrt for performance)
 */
function distanceSquared(a, b) {
    const dlat = a.lat - b.lat;
    const dlon = a.lon - b.lon;
    return dlat * dlat + dlon * dlon;
}

/**
 * Merge multiple arrays of points and compute their combined convex hull
 * @param {Array<Array<{lat: number, lon: number}>>} pointArrays - Arrays of point arrays
 * @returns {Array<{lat: number, lon: number}>} Combined convex hull
 */
export function mergeConvexHulls(pointArrays) {
    const allPoints = pointArrays.flat();
    return computeConvexHull(allPoints);
}
