import SimpleController from './SimpleController'


function modesAreEqual(oldModes, newModes) {
  return Object.keys(oldModes).sort().join(',') === Object.keys(newModes).sort().join(',')
}


export default class ResponsiveDualModeController extends SimpleController {
  static actions = {
    selectMode(mode) {
      this.setMode(mode)
    },
    selectTransformed() {
      this.setMode('transformed')
    },
    selectView() {
      this.setMode('view')
    },
    selectConsole() {
      this.setMode('console')
    },
    selectSource() {
      this.setMode('source')
    },
  }

  constructor(env) {
    super(env)

    const {
      /**
       * Selects the secondary pane to display in the case that the user is
       * viewing the source pane on a small screen, and then the screen
       * expands to allow a second pane.
       */
      defaultSecondary='view',

      /**
       * The default mode to display upon load when the screen only contains
       * space for a single pane.
       */
      defaultMode='source',

      /**
       * The maximum width for which only a single pane will be used.
       */
      maxSinglePaneWidth=999,
    } = env

    this.setState({
      defaultSecondary,
      defaultMode,
      maxSinglePaneWidth,
      modes: {},
      primary: defaultMode,
    })
  }

  envWillUpdate(newEnv) {
    if (newEnv.maxSinglePaneWidth !== this.env.maxSinglePaneWidth) {
      this.maxSinglePaneWidth = newEnv.maxSinglePaneWidth
      this._recalc()
    }
  }

  setMode(newMode) {
    this.primary = newMode
    this._recalc()
  }

  setDimensions({ width }) {
    this.width = width
    this._recalc()
  }

  _recalc() {
    const oldModes = this.modes
    const newModes = {}

    if (this.width !== undefined && this.width <= this.maxSinglePaneWidth) {
      newModes[this.primary] = true
    }
    else {
      newModes['source'] = true
      newModes[this.primary === 'source' ? this.defaultSecondary : this.primary] = true
    }

    if (!modesAreEqual(newModes, oldModes)) {
      this.modes = newModes

      for (let listener of this.listeners) {
        listener(this.modes)
      }
    }
  }
}
