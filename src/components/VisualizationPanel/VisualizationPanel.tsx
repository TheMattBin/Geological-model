import Background from '../Background/Background';
import styles from './VisualizationPanel.module.css';
import type { ViewSettings, VariableMetadata, VolumeMetadata } from '@three/types';

interface Props {
  metadata: VolumeMetadata | null;
  selectedVariable?: VariableMetadata;
  settings: ViewSettings;
  update: (patch: Partial<ViewSettings>) => void;
  selectVariable: (id: number) => void;
}
export default function VisualizationPanel({ metadata, selectedVariable, settings: s, update, selectVariable }: Props) {
  const range = selectedVariable?.range ?? { min: 0, max: 1 };
  const step = (range.max - range.min) / 100 || 1;
  return (
    <Background>
      <h2 className={styles.heading}>Visualization</h2>
      <div className={styles.radioGroup}>
        {metadata?.variables.map((variable) => (
          <label key={variable.id} className={styles.radioLabel}>
            <input
              type='radio'
              name='variable'
              checked={selectedVariable?.id === variable.id}
              onChange={() => selectVariable(variable.id)}
              className={styles.radio}
            />
            <span>{variable.name}</span>
          </label>
        ))}
      </div>
      <label className={styles.switchLabel}>
        <span>Display sections</span>
        <input
          type='checkbox'
          checked={s.displaySections}
          onChange={(e) => update({ displaySections: e.target.checked })}
          className={styles.toggleSwitch}
        />
      </label>
      {s.displaySections &&
        (['NS', 'WE'] as const).map((orientation) => {
          const axis = orientation === 'NS' ? 'x' : 'y';
          const bounds = metadata?.bounds[axis];
          const coordinate = bounds ? bounds.min + s.sections[orientation] * (bounds.max - bounds.min) : null;
          return (
            <label key={orientation} className={styles.sectionControl}>
              <span>{orientation === 'NS' ? 'N–S cut (east–west position)' : 'W–E cut (north–south position)'}</span>
              <input
                type='range'
                min={0}
                max={100}
                step={1}
                value={Math.round(s.sections[orientation] * 100)}
                onChange={(e) => update({ sections: { ...s.sections, [orientation]: Number(e.target.value) / 100 } })}
                className={styles.slider}
              />
              <output>
                {Math.round(s.sections[orientation] * 100)}%
                {coordinate !== null &&
                  ` · ${axis.toUpperCase()} = ${Number(coordinate.toPrecision(6))} ${metadata?.coordinateUnit ?? 'units'}`}
              </output>
            </label>
          );
        })}
      {selectedVariable?.type === 'continuous' && (
        <>
          <label className={styles.sectionControl}>
            <span>Opacity</span>
            <input
              type='range'
              min={0}
              max={3}
              step={0.05}
              value={s.opacity}
              onChange={(e) => update({ opacity: Number(e.target.value) })}
              className={styles.slider}
            />
            <output>{s.opacity.toFixed(2)}×</output>
          </label>
          {(['Minimum value', 'Maximum value'] as const).map((label, index) => (
            <label key={label} className={styles.sectionControl}>
              <span>
                {label} {selectedVariable.unit ? `(${selectedVariable.unit})` : ''}
              </span>
              <input
                type='range'
                min={range.min}
                max={range.max}
                step={step}
                disabled={range.min === range.max}
                value={s.valueWindow[index]}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  update({
                    valueWindow:
                      index === 0
                        ? [Math.min(value, s.valueWindow[1]), s.valueWindow[1]]
                        : [s.valueWindow[0], Math.max(value, s.valueWindow[0])]
                  });
                }}
                className={styles.slider}
              />
              <output>{s.valueWindow[index].toPrecision(4)}</output>
            </label>
          ))}
          <label className={styles.switchLabel}>
            <span>Isosurface</span>
            <input
              type='checkbox'
              checked={s.isosurface}
              onChange={(e) => update({ isosurface: e.target.checked })}
              className={styles.toggleSwitch}
            />
          </label>
          {s.isosurface && (
            <label className={styles.sectionControl}>
              <span>Isosurface value {selectedVariable.unit ? `(${selectedVariable.unit})` : ''}</span>
              <input
                type='range'
                min={range.min}
                max={range.max}
                step={step}
                disabled={range.min === range.max}
                value={s.isovalue}
                onChange={(e) => update({ isovalue: Number(e.target.value) })}
                className={styles.slider}
              />
              <output>{s.isovalue.toPrecision(3)}</output>
            </label>
          )}
        </>
      )}
      <div className='separator' />
      <label className={styles.sectionControl}>
        <span>Vertical exaggeration</span>
        <input
          type='range'
          min={1}
          max={5}
          step={1}
          value={s.exaggeration}
          onChange={(e) => update({ exaggeration: Number(e.target.value) })}
          className={styles.slider}
        />
        <output>{s.exaggeration}x</output>
      </label>
    </Background>
  );
}
