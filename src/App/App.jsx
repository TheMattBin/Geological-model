import { useEffect, useState } from 'react';
import { dataPath } from '../config';
import { UIProvider } from '../UIContext.jsx';
import Scene3D from '../components/Scene3D/Scene3D';
import Title from '../components/Title/Title';
import MenuPanel from '../components/MenuPanel/MenuPanel';
import VisualizationPanel from '../components/VisualizationPanel/VisualizationPanel';
import VolumeController from '../components/VolumeController/VolumeController';
import ErrorBoundary from '../components/ErrorBoundary/ErrorBoundary';
import * as styles from './App.module.css';

/**
 * App component using Three.js for volume rendering
 */
export const App = () => {
  const [metadata, setMetadata] = useState(null);
  const [selectedVariableId, setSelectedVariableId] = useState(null);
  const variables = metadata?.variables ?? [];
  const selectedVariable = variables.find((variable) => variable.id === selectedVariableId) ?? variables[0];
  const [isosurface, setIsosurface] = useState(false);
  const [isovalue, setIsovalue] = useState(0.5);
  useEffect(() => {
    const range = selectedVariable?.range;
    setIsovalue(range ? (range.min + range.max) / 2 : 0.5);
  }, [selectedVariable]);
  const [exaggeration, setExaggeration] = useState(1);
  const [legendInfo, setLegendInfo] = useState(null);
  const [sections, setSections] = useState({ NS: 0.68, WE: 0.82 });
  const [displaySections, setDisplaySections] = useState(true);

  return (
    <UIProvider>
      <ErrorBoundary>
        <Scene3D dataPath={dataPath} onMetadataChange={setMetadata}>
          <VolumeController
            selectedVariable={selectedVariable}
            exaggeration={exaggeration}
            sections={sections}
            displaySections={displaySections}
            isosurface={isosurface}
            isovalue={isovalue}
            legendInfo={legendInfo}
            setLegendInfo={setLegendInfo}
          />
        </Scene3D>
      </ErrorBoundary>
      <div className={styles.appLayout}>
        <header className={styles.appTitle}>
          <Title text='Geological Volume Explorer' size='large'></Title>
        </header>
        <div className={styles.appContent}>
          <div className={styles.leftPane}>
            <ErrorBoundary>
              <MenuPanel metadata={metadata} legendInfo={legendInfo} setLegendInfo={setLegendInfo} />
            </ErrorBoundary>
          </div>
          <div className={styles.rightPane}>
            <ErrorBoundary>
              <VisualizationPanel
                selectedVariable={selectedVariable}
                variables={variables}
                setSelectedVariableId={setSelectedVariableId}
                exaggeration={exaggeration}
                setExaggeration={setExaggeration}
                sections={sections}
                setSections={setSections}
                displaySections={displaySections}
                setDisplaySections={setDisplaySections}
                isosurface={isosurface}
                setIsosurface={setIsosurface}
                isovalue={isovalue}
                setIsovalue={setIsovalue}
              />
            </ErrorBoundary>
          </div>
        </div>
        <footer className={styles.appFooter}>
          <p>
            {metadata?.synthetic
              ? 'Synthetic demonstration dataset · Not a surveyed Hong Kong model.'
              : (metadata?.description ?? 'Explore geological volume data.')}
          </p>
          <p className={styles.Logo}>
            <a href='https://github.com/TheMattBin' target='_blank' rel='noreferrer'>
              <img src='./assets/github_logo.png' alt='GitHub'></img>
            </a>
          </p>
        </footer>
      </div>
    </UIProvider>
  );
};

export default App;
