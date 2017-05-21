import PureController from './PureController'


export default class ResponsiveDualModeController extends PureController {
  static defaultProps = {
    /**
     * Selects the secondary pane to display in the case that the user is
     * viewing the source pane on a small screen, and then the screen
     * expands to allow a second pane.
     */
    defaultSecondary: 'view',

    /**
     * The default mode to display upon load when the screen only contains
     * space for a single pane.
     */
    defaultMode: 'source',

    /**
     * The maximum width for which only a single pane will be used.
     */
    maxSinglePaneWidth: 999,
  }

  static actions = {
    selectMode(mode) {
      this.setState({ primary: mode })
    },
    selectTransformed() {
      this.setState({ primary: 'transformed' })
    },
    selectView() {
      this.setState({ primary: 'view' })
    },
    selectConsole() {
      this.setState({ primary: 'console' })
    },
    selectSource() {
      this.setState({ primary: 'source' })
    },
  }

  constructor(props) {
    super(props)

    this.state = {
      primary: props.defaultMode,
    }
  }

  output() {
    const props = this.props
    const primary = this.state.primary
    const modes = {}

    if (props.width !== undefined && props.width <= props.maxSinglePaneWidth) {
      modes[primary] = true
    }
    else {
      modes['source'] = true
      modes[primary === 'source' ? props.defaultSecondary : primary] = true
    }

    return Object.assign(modes, this.actions)
  }
}
