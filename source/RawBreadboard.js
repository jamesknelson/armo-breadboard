import React, { Component, PropTypes } from 'react'
import ReactDOM from 'react-dom'
import Breadboard from './Breadboard'
import { injectDimensions } from './Injectors'
import ResponsiveDualModeController from './ResponsiveDualModeController'
import { controlledBy } from 'react-controllers'
import compose from './compose'
import { transform } from 'babel-core'
import latestPreset from 'babel-preset-latest'
import reactPreset from 'babel-preset-react'


function rawPrepare(source, require, window) {
  try {
    const exports = {}
    const module = { exports: exports }

    const execute = new Function(
      'window',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'fetch',
      'History',
      'console',
      'module',
      'exports',
      'require',
      'breadboard',
      'React',
      'ReactDOM',
      '__MOUNT__',
      source
    )

    return (mount, props={}) => {
      try {
        execute(
          window,
          window.setTimeout,
          window.setInterval,
          window.requestAnimationFrame,
          window.fetch,
          window.History,
          window.console,
          module,
          exports,
          require,
          props,
          React,
          ReactDOM,
          mount
        )
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


const decorate = compose(
  injectDimensions.withConfiguration({ height: null }),
  controlledBy({ modes: ResponsiveDualModeController })
)

export default decorate(class RawBreadboard extends Component {
  static propTypes = {
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
    appId: 'app',
  }

  renderTheme = (props) => {
    return this.props.theme.renderBreadboard(Object.assign({}, props, {
      reactVersion: React.version,
      appId: this.props.appId,
    }))
  }

  render() {
    return (
      <Breadboard
        {...this.props}
        prepare={rawPrepare}
        renderToString={null}
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
})