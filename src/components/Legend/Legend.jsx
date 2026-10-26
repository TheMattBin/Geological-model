import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import * as styles from './Legend.module.css';

/**
 * Convert RGBA array to CSS color string
 */
const rgbaToCss = (color) => {
  if (typeof color === 'string') return color;
  if (Array.isArray(color)) {
    const [r, g, b, a = 255] = color;
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }
  if (color && typeof color === 'object') {
    const { r, g, b, a = 255 } = color;
    return `rgba(${r}, ${g}, ${b}, ${(a ?? 255) / 255})`;
  }
  return '#888';
};

/**
 * Convert color to hex string
 */
const colorToHex = (color) => {
  if (typeof color === 'string') return color;
  if (Array.isArray(color)) {
    const [r, g, b] = color;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  if (color && typeof color === 'object') {
    const { r, g, b } = color;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return '#888888';
};

/**
 * Create CSS gradient from color stops
 */
const createGradient = (colors) => {
  if (!colors || colors.length === 0) return 'linear-gradient(90deg, #333, #fff)';

  const gradientColors = colors.map((c) => {
    const hex = colorToHex(c.color);
    const position = (c.position ?? 0) * 100;
    return `${hex} ${position}%`;
  });
  return `linear-gradient(90deg, ${gradientColors.join(', ')})`;
};

const Chip = ({ index, color, enabled, onClick, value, label }) => {
  const cssColor = rgbaToCss(color);

  return (
    <button key={index} aria-pressed={enabled} className={styles.chip} datavalue={value} onClick={onClick}>
      <span className={styles.swatch} style={{ backgroundColor: cssColor }} aria-hidden='true' />
      {label}
    </button>
  );
};

Chip.propTypes = {
  index: PropTypes.number,
  color: PropTypes.any.isRequired,
  enabled: PropTypes.bool,
  onClick: PropTypes.func,
  value: PropTypes.any,
  label: PropTypes.string
};

const ContinuousLegend = ({ colors }) => {
  const divRef = useRef(null);

  useEffect(() => {
    if (divRef.current && colors && colors.length > 0) {
      divRef.current.style.background = createGradient(colors);
      divRef.current.style.height = '20px';
    }
  }, [divRef, colors]);

  return (
    <div className={styles.gradientContainer}>
      <div ref={divRef} className={styles.gradient}></div>
    </div>
  );
};

ContinuousLegend.propTypes = {
  colors: PropTypes.array.isRequired
};

const DiscreteLegend = ({ uniqueValues, uniqueValuesChanged }) => {
  const toggleVisibility = (event) => {
    const value = Number(event.currentTarget.getAttribute('datavalue'));
    const newUniqueValues = uniqueValues.map((uv) => {
      if (uv.value === value) {
        return { ...uv, enabled: !uv.enabled };
      }
      return uv;
    });
    uniqueValuesChanged(newUniqueValues);
  };

  return uniqueValues.map((uv, index) => (
    <Chip
      enabled={uv.enabled}
      key={index}
      color={uv.color}
      value={uv.value}
      onClick={toggleVisibility}
      label={uv.label}
    />
  ));
};

DiscreteLegend.propTypes = {
  uniqueValues: PropTypes.array.isRequired,
  uniqueValuesChanged: PropTypes.func.isRequired
};

/**
 * Legend component
 */
const Legend = ({ legendInfo, setLegendInfo }) => {
  return (
    <div className={styles.container}>
      {legendInfo ? (
        <div>
          <p className={styles.legendTitle}>{legendInfo.label}</p>
          {legendInfo.continuous ? (
            <div>
              <div className={styles.labels}>
                <div>{legendInfo.range[0].toPrecision(3)}</div>
                <div>
                  {legendInfo.range[1].toPrecision(3)} {legendInfo.unit}
                </div>
              </div>
              <ContinuousLegend colors={legendInfo.colorStops} />
            </div>
          ) : (
            <DiscreteLegend
              uniqueValues={legendInfo.uniqueValues || []}
              uniqueValuesChanged={(uv) => {
                if (uv) {
                  setLegendInfo({
                    id: legendInfo.id,
                    label: legendInfo.label,
                    continuous: false,
                    uniqueValues: uv
                  });
                }
              }}
            />
          )}
        </div>
      ) : (
        <div>Building legend...</div>
      )}
    </div>
  );
};

Legend.propTypes = {
  legendInfo: PropTypes.object,
  setLegendInfo: PropTypes.func
};

export default React.memo(Legend);
