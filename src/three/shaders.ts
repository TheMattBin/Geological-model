/**
 * GLSL Shaders for volumetric rendering using ray marching
 *
 * These shaders implement direct volume rendering with:
 * - Ray marching through a 3D texture
 * - Transfer function for color mapping
 * - Support for both discrete and continuous data
 * - Clipping planes for slices and sections
 * - Alpha compositing for transparency
 */

// Simple debug shader that always shows something
export const debugVertexShader = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vPosition;

void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const debugFragmentShader = /* glsl */ `
precision highp float;
in vec3 vPosition;
out vec4 fragColor;

void main() {
    // Color based on position to show 3D structure
    vec3 color = vPosition * 0.5 + 0.5;
    fragColor = vec4(color, 0.8);
}
`;

export const volumeVertexShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

// Three.js built-in attributes (required for RawShaderMaterial)
in vec3 position;

// Varyings
out vec3 vOrigin;
out vec3 vDirection;

// Three.js built-in uniforms (required for RawShaderMaterial)
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPos;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Ray origin in model space (camera position transformed to model space)
    vOrigin = cameraPos;
    
    // Ray direction from camera through vertex (in model space)
    vDirection = position - cameraPos;
}
`;

export const volumeFragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 fragColor;

uniform sampler3D uVolumeData;
uniform sampler2D uTransferFunction;
uniform bool uDiscreteMode;
uniform bool uFloatData;
uniform vec2 uValueRange;
uniform bool uHasNoData;
uniform float uNoDataValue;
uniform vec3 uVolumeDimensions;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
uniform int uSteps;
uniform float uDensity;
uniform bool uSliceXEnabled;
uniform float uSliceXMin;
uniform float uSliceXMax;
uniform bool uSliceYEnabled;
uniform float uSliceYMin;
uniform float uSliceYMax;
uniform bool uSliceZEnabled;
uniform float uSliceZMin;
uniform float uSliceZMax;
uniform bool uSectionNSEnabled;
uniform float uSectionNSPosition;
uniform bool uSectionWEEnabled;
uniform float uSectionWEPosition;
uniform bool uIsosurfaceEnabled;
uniform float uIsosurfaceValue;
uniform vec3 uIsosurfaceColor;
uniform float uIsosurfaceOpacity;
uniform float uVerticalExaggeration;

// Parallel rays must not divide by zero at a box face.
vec2 intersectBox(vec3 origin, vec3 direction, vec3 lo, vec3 hi) {
    vec3 safeDirection = mix(direction, vec3(1e-8), lessThan(abs(direction), vec3(1e-8)));
    vec3 a = (lo - origin) / safeDirection;
    vec3 b = (hi - origin) / safeDirection;
    vec3 near = min(a, b);
    vec3 far = max(a, b);
    return vec2(max(max(near.x, near.y), near.z), min(min(far.x, far.y), far.z));
}

float rawValue(vec3 pos) {
    vec3 uv = (pos - uBoundsMin) / (uBoundsMax - uBoundsMin);
    return texture(uVolumeData, clamp(uv, vec3(0.0), vec3(1.0))).r;
}

bool isNoData(float value) {
    return isnan(value) || isinf(value) || (uHasNoData && abs(value - uNoDataValue) < 1e-6);
}

float normalizedValue(float value) {
    return clamp((value - uValueRange.x) / max(uValueRange.y - uValueRange.x, 1e-8), 0.0, 1.0);
}

vec3 toLinear(vec3 color) {
    return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
}

vec3 toSRGB(vec3 color) {
    return mix(color * 12.92, 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
        step(vec3(0.0031308), color));
}

vec3 faceNormal(vec3 pos, vec3 lo, vec3 hi) {
    vec3 distance = min(abs(pos - lo), abs(pos - hi));
    vec3 normal = vec3(0.0);
    if (distance.x <= distance.y && distance.x <= distance.z) normal.x = pos.x < (lo.x + hi.x) * 0.5 ? -1.0 : 1.0;
    else if (distance.y <= distance.z) normal.y = pos.y < (lo.y + hi.y) * 0.5 ? -1.0 : 1.0;
    else normal.z = pos.z < (lo.z + hi.z) * 0.5 ? -1.0 : 1.0;
    return normal;
}

float lighting(vec3 normal) {
    return 0.65 + 0.35 * max(dot(normal, normalize(vec3(0.4, -0.6, 1.0))), 0.0);
}

vec3 gradient(vec3 pos) {
    vec3 cell = (uBoundsMax - uBoundsMin) / uVolumeDimensions;
    vec3 g = vec3(
        rawValue(pos + vec3(cell.x, 0, 0)) - rawValue(pos - vec3(cell.x, 0, 0)),
        rawValue(pos + vec3(0, cell.y, 0)) - rawValue(pos - vec3(0, cell.y, 0)),
        rawValue(pos + vec3(0, 0, cell.z)) - rawValue(pos - vec3(0, 0, cell.z))
    ) / (cell * vec3(1, 1, uVerticalExaggeration));
    return dot(g, g) > 1e-12 ? normalize(g) : vec3(0, 0, 1);
}

void main() {
    vec3 span = uBoundsMax - uBoundsMin;
    vec3 lo = uBoundsMin;
    vec3 hi = uBoundsMax;
    if (uSliceXEnabled) { lo.x += span.x * uSliceXMin; hi.x = uBoundsMin.x + span.x * uSliceXMax; }
    if (uSliceYEnabled) { lo.y += span.y * uSliceYMin; hi.y = uBoundsMin.y + span.y * uSliceYMax; }
    if (uSliceZEnabled) { lo.z += span.z * uSliceZMin; hi.z = uBoundsMin.z + span.z * uSliceZMax; }
    // X = east, Y = north, Z = elevation. NS planes have constant X.
    if (uSectionNSEnabled) hi.x = min(hi.x, uBoundsMin.x + span.x * uSectionNSPosition);
    if (uSectionWEEnabled) hi.y = min(hi.y, uBoundsMin.y + span.y * uSectionWEPosition);
    if (any(lessThanEqual(hi, lo))) discard;

    vec3 direction = normalize(vDirection);
    vec2 hit = intersectBox(vOrigin, direction, lo, hi);
    hit.x = max(hit.x, 0.0);
    if (hit.y <= hit.x) discard;

    float stepSize = (hit.y - hit.x) / float(uSteps);
    vec3 entry = vOrigin + direction * hit.x;
    vec3 normal = faceNormal(entry, lo, hi);
    // Continuous opacity uses distance measured in voxels, independent of step count.
    float voxelStep = length(direction * stepSize / span * uVolumeDimensions);
    vec4 accumulated = vec4(0.0);
    float previous = -1.0;
    float previousT = hit.x;

    for (int i = 0; i < uSteps; i++) {
        // Sample categorical cut faces immediately inside the boundary, avoiding stepped cuts.
        float t = hit.x + (float(i) + (uDiscreteMode ? 0.0001 : 0.5)) * stepSize;
        vec3 pos = vOrigin + direction * t;
        float raw = rawValue(pos);
        if (isNoData(raw)) { previous = -1.0; continue; }
        float value = normalizedValue(raw);

        if (uIsosurfaceEnabled && !uDiscreteMode) {
            if (previous >= 0.0 && (previous - uIsosurfaceValue) * (value - uIsosurfaceValue) <= 0.0
                && abs(value - previous) > 1e-8) {
                float fraction = clamp((uIsosurfaceValue - previous) / (value - previous), 0.0, 1.0);
                vec3 surface = vOrigin + direction * mix(previousT, t, fraction);
                vec3 n = gradient(surface);
                if (dot(n, direction) > 0.0) n = -n;
                accumulated = vec4(toLinear(uIsosurfaceColor) * lighting(n) * uIsosurfaceOpacity, uIsosurfaceOpacity);
                break;
            }
            previous = value;
            previousT = t;
            continue;
        }

        float classValue = uFloatData ? raw : raw * 255.0;
        if (uDiscreteMode && (classValue < 0.0 || classValue > 255.0)) continue;
        float coordinate = uDiscreteMode ? (floor(classValue + 0.5) + 0.5) / 256.0 : value;
        vec4 color = texture(uTransferFunction, vec2(coordinate, 0.5));
        float alpha = uDiscreteMode ? color.a : 1.0 - exp(-color.a * uDensity * voxelStep);
        vec3 rgb = toLinear(color.rgb);
        if (uDiscreteMode) rgb *= lighting(normal);
        accumulated.rgb += (1.0 - accumulated.a) * rgb * alpha;
        accumulated.a += (1.0 - accumulated.a) * alpha;
        if (accumulated.a > 0.995) break;
    }
    if (accumulated.a <= 0.0) discard;
    // Convert straight linear color to display space, then premultiply for material blending.
    fragColor = vec4(toSRGB(accumulated.rgb / accumulated.a) * accumulated.a, accumulated.a);
}
`;

export const isosurfaceVertexShader = /* glsl */ `
precision highp float;

out vec3 vNormal;
out vec3 vWorldPosition;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

void main() {
    vNormal = normalMatrix * normal;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const isosurfaceFragmentShader = /* glsl */ `
precision highp float;

in vec3 vNormal;
in vec3 vWorldPosition;

out vec4 fragColor;

uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uLightDirection;
uniform vec3 uAmbientColor;

void main() {
    // Normalize normal
    vec3 normal = normalize(vNormal);
    
    // Simple directional lighting
    float diff = max(dot(normal, uLightDirection), 0.0);
    
    // Combine ambient and diffuse
    vec3 lighting = uAmbientColor + diff * vec3(1.0);
    
    // Final color
    vec3 finalColor = uColor * lighting;
    
    fragColor = vec4(finalColor, uOpacity);
}
`;

export const gridVertexShader = /* glsl */ `
precision highp float;

out vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const gridFragmentShader = /* glsl */ `
precision highp float;

in vec2 vUv;

out vec4 fragColor;

uniform vec3 uColor;
uniform float uOpacity;
uniform float uGridSize;
uniform float uLineWidth;

void main() {
    // Create grid lines
    vec2 grid = abs(fract(vUv * uGridSize - 0.5) - 0.5) / fwidth(vUv * uGridSize);
    float line = min(grid.x, grid.y);
    float alpha = 1.0 - min(line, 1.0);
    
    if (alpha < 0.1) {
        discard;
    }
    
    fragColor = vec4(uColor, alpha * uOpacity);
}
`;
