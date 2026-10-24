const AXES = ['x', 'y', 'z'];

function getAxisSpan(metadata, axis) {
  const bounds = metadata.bounds?.[axis];
  if (bounds && bounds.max > bounds.min) return bounds.max - bounds.min;
  return metadata.dimensions[axis];
}

export function getNormalizedVolumeSize(metadata, verticalExaggeration = 1) {
  const spans = AXES.map((axis) => getAxisSpan(metadata, axis));
  const maxSpan = Math.max(...spans, Number.EPSILON);
  const exaggeration = Math.max(verticalExaggeration || 1, Number.EPSILON);

  return {
    x: spans[0] / maxSpan,
    y: spans[1] / maxSpan,
    z: (spans[2] / maxSpan) * exaggeration
  };
}

export function getCameraDistance(size, fieldOfView = 45, margin = 1.35, aspect = 1) {
  const radius = Math.hypot(size.x, size.y, size.z) / 2;
  const verticalHalfFov = (fieldOfView * Math.PI) / 360;
  const halfFovRadians = Math.min(verticalHalfFov, Math.atan(Math.tan(verticalHalfFov) * aspect));
  return (radius / Math.sin(halfFovRadians)) * margin;
}

export function validateVolumeMetadata(metadata) {
  const warnings = [];

  for (const axis of AXES) {
    const bounds = metadata.bounds?.[axis];
    if (!bounds) {
      warnings.push(`Axis ${axis} is missing bounds`);
    } else if (!(bounds.max > bounds.min)) {
      warnings.push(`Axis ${axis} has a non-positive span`);
    }

    if (!(metadata.dimensions?.[axis] > 0)) {
      warnings.push(`Axis ${axis} has an invalid voxel dimension`);
    }
  }

  return warnings;
}
