import Background from '../Background/Background';
import Title from '../Title/Title';
import * as styles from './VisualizationPanel.module.css';
import PropTypes from 'prop-types';

const VisualizationPanel = ({
  variables,
  selectedVariable,
  setSelectedVariableId,
  exaggeration,
  setExaggeration,
  sections,
  setSections,
  displaySections,
  setDisplaySections,
  isosurface,
  setIsosurface,
  isovalue,
  setIsovalue
}) => (
  <Background title='Visualization' size='small'>
    <Title text='Variables' />
    <div className={styles.radioGroup}>
      {variables.map((variable) => (
        <label key={variable.id} className={styles.radioLabel}>
          <input
            type='radio'
            name='variable'
            checked={selectedVariable?.id === variable.id}
            onChange={() => setSelectedVariableId(variable.id)}
            className={styles.radio}
          />
          <span>{variable.name}</span>
        </label>
      ))}
    </div>
    <div className={styles.dynamicSections}>
      <label className={styles.switchLabel}>
        <span>Display sections</span>
        <input
          type='checkbox'
          checked={displaySections}
          onChange={(e) => setDisplaySections(e.target.checked)}
          className={styles.toggleSwitch}
        />
      </label>
      {displaySections &&
        ['NS', 'WE'].map((orientation) => (
          <label key={orientation} className={styles.sectionControl}>
            <span>{orientation === 'NS' ? 'N–S cut (east–west position)' : 'W–E cut (north–south position)'}</span>
            <input
              type='range'
              min={1}
              max={100}
              step={1}
              value={Math.round(sections[orientation] * 100)}
              onChange={(e) => setSections({ ...sections, [orientation]: Number(e.target.value) / 100 })}
              className={styles.slider}
            />
            <output>{Math.round(sections[orientation] * 100)}%</output>
          </label>
        ))}
    </div>
    {selectedVariable?.type === 'continuous' && (
      <div className={styles.dynamicSections}>
        <label className={styles.switchLabel}>
          <span>Isosurface</span>
          <input
            type='checkbox'
            checked={isosurface}
            onChange={(e) => setIsosurface(e.target.checked)}
            className={styles.toggleSwitch}
          />
        </label>
        {isosurface && (
          <label className={styles.sectionControl}>
            <span>Isosurface value {selectedVariable.unit ? `(${selectedVariable.unit})` : ''}</span>
            <input
              type='range'
              min={selectedVariable.range?.min ?? 0}
              max={selectedVariable.range?.max ?? 1}
              step={((selectedVariable.range?.max ?? 1) - (selectedVariable.range?.min ?? 0)) / 100 || 1}
              value={isovalue}
              onChange={(e) => setIsovalue(Number(e.target.value))}
              className={styles.slider}
            />
            <output>{isovalue.toPrecision(3)}</output>
          </label>
        )}
      </div>
    )}
    <div className='separator'></div>
    <label className={styles.sectionControl}>
      <span>Vertical exaggeration</span>
      <input
        type='range'
        min={1}
        max={5}
        step={1}
        value={exaggeration}
        onChange={(e) => setExaggeration(Number(e.target.value))}
        className={styles.slider}
      />
      <output>{exaggeration}x</output>
    </label>
  </Background>
);

VisualizationPanel.propTypes = {
  variables: PropTypes.array.isRequired,
  selectedVariable: PropTypes.object,
  setSelectedVariableId: PropTypes.func,
  exaggeration: PropTypes.number,
  setExaggeration: PropTypes.func,
  sections: PropTypes.object,
  setSections: PropTypes.func,
  displaySections: PropTypes.bool,
  setDisplaySections: PropTypes.func,
  isosurface: PropTypes.bool,
  setIsosurface: PropTypes.func,
  isovalue: PropTypes.number,
  setIsovalue: PropTypes.func
};

export default VisualizationPanel;
