import React, { Component, PropTypes } from 'react'
import ReactDOM from 'react-dom'
import Breadboard from './Breadboard'
import ResponsiveDualModeController from './ResponsiveDualModeController'
import { transform } from 'babel-core'
import latestPreset from 'babel-preset-latest'
import reactPreset from 'babel-preset-react'


function rawPrepare(source, require, console) {
  try {
    var execute
    var exports = {}
    var module = { exports: exports }
    eval('execute = function execute(module, exports, require, console, breadboard, React, ReactDOM, __MOUNT__) { '+source+' }')

    // TODO: maybe unmount any previous React component on the mountpoint first
    // add React to injected stuff

    return (mount, props={}) => {
      try {
        execute(module, exports, require, console, props, React, ReactDOM, mount)
      }
      catch (err) {
        return err
      }
    }
  }
  catch (err) {
    return () => err
  }
}


export default class RawBreadboard extends Component {
  static propTypes = {
    /**
     * The default mode to display upon load when the screen only contains
     * space for a single pane.
     */
    defaultMode: PropTypes.oneOf(['source', 'view', 'transformed', 'console']),

    /**
     * Selects the secondary pane to display in the case that the user is
     * viewing the source pane on a small screen, and then the screen
     * expands to allow a second pane.
     */
    defaultSecondary: PropTypes.oneOf(['view', 'transformed', 'console']).isRequired,

    /**
     * When this id is used in a `document.getElementById` call, the entire
     * call will be replaced with the mountpoint's element. Note that this
     * means previews cannot be generated server-side.
     */
    appId: PropTypes.string.isRequired,

    /**
     * The breadboard's theme.
     */
    theme: PropTypes.shape({
      renderBreadboard: PropTypes.func,
      renderEditor: PropTypes.func,
    }).isRequired,
  }

  static defaultProps = {
    defaultMode: 'source',
    defaultSecondary: 'view',
    appId: 'app',
  }

  constructor(props) {
    super(props)

    this.modesController = new ResponsiveDualModeController({
      maxSinglePaneWidth: props.theme.maxSinglePaneWidth,
      defaultSecondary: props.defaultSecondary,
      defaultMode: props.defaultMode,
    })
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.theme.maxSinglePaneWidth !== this.props.theme.maxSinglePaneWidth) {
      this.modesController.environmentDidChange({
          maxSinglePaneWidth: nextProps.theme.maxSinglePaneWidth,
      })
    }
  }

  renderTheme = (props) => {
    return this.props.theme.renderBreadboard(Object.assign({}, props, {
      reactVersion: React.version,
      appId: this.props.appId,
    }))
  }

  render() {
    const { ...other } = this.props

    return (
      <Breadboard
        {...other}
        modesController={this.modesController}
        prepare={rawPrepare}
        renderEditorElement={this.props.theme.renderEditor}
        theme={this.renderTheme}
        transform={this.transform}
      />
    )
  }

  transform = (source) => {
    let transformed
    let error = null

    const appPattern = new RegExp(`document\\s*.\\s*getElementById\\s*\\(\\s*['"]${this.props.appId}['"]\\s*\\)`, 'g')
    const sourceWithAppId = source.replace(appPattern, ' __MOUNT__ ')

    try {
      transformed = transform(sourceWithAppId, { presets: [reactPreset, latestPreset] }).code
    }
    catch (e) {
      error = e
    }

    return {
      transformedSource: transformed,
      executableSource: transformed,
      error: error, 
    }
  }
}
