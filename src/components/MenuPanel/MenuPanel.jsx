import Background from '../Background/Background';
import Legend from '../Legend/Legend';
import * as styles from './MenuPanel.module.css';
import { useUIContext } from '../../UIContext.jsx';
import PropTypes from 'prop-types';

/**
 * MenuPanel component
 */
const MenuPanel = ({ metadata, legendInfo, setLegendInfo }) => {
  const { enableGrid, setEnableGrid, displayLegend, setDisplayLegend, displayFault, setDisplayFault } = useUIContext();

  return (
    <Background title='' size='small'>
      <div className={styles.variableInfo}>
        <label className={`${styles.label} ${styles.switchLabel}`}>
          <span>Display legend</span>
          <input
            type='checkbox'
            className={styles.toggleSwitch}
            checked={displayLegend}
            onChange={(e) => setDisplayLegend(e.target.checked)}
          />
        </label>
        {displayLegend && <Legend legendInfo={legendInfo} setLegendInfo={setLegendInfo} />}
      </div>
      <div className={styles.layerVisibility}>
        <label className={`${styles.label} ${styles.switchLabel}`}>
          <span>Display grid</span>
          <input
            type='checkbox'
            className={styles.toggleSwitch}
            checked={enableGrid}
            onChange={(e) => setEnableGrid(e.target.checked)}
          />
        </label>
      </div>
      {legendInfo?.uniqueValues?.some((entry) => entry.role === 'fault') && (
        <div className={styles.layerVisibility}>
          <label className={`${styles.label} ${styles.switchLabel}`}>
            <span>Display fault</span>
            <input
              type='checkbox'
              className={styles.toggleSwitch}
              checked={displayFault}
              onChange={(e) => setDisplayFault(e.target.checked)}
            />
          </label>
        </div>
      )}
      <div className='separator'></div>
      <div className={styles.overviewMap}>
        <div>{metadata?.description ?? 'Loading dataset…'}</div>
      </div>
    </Background>
  );
};

MenuPanel.propTypes = {
  metadata: PropTypes.object,
  legendInfo: PropTypes.any,
  setLegendInfo: PropTypes.func
};

export default MenuPanel;
