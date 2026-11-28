import React from 'react'
import ReactDOM from 'react-dom/client'
import {lazy, Suspense, useState} from 'react'
import SpaceChooser from './components/SpaceChooser'
import {PageBoundary} from './components/WorkspaceUI'
import './index.css'
import './workspace.css'

const App=lazy(()=>import('./App'))

function Entry() {
  const [initialSpace,setInitialSpace]=useState(null)
  return <PageBoundary>
    <Suspense fallback={<SpaceChooser onChoose={setInitialSpace}/>}>
      <App initialSpace={initialSpace}/>
    </Suspense>
  </PageBoundary>
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Entry />
  </React.StrictMode>
)
