import ExecutionEnvironment from 'exenv'
import { createController } from 'hatt'
import React, { Component, PropTypes } from 'react'
import ResizeObserver from 'resize-observer-polyfill'
import ReactDOM from 'react-dom'
import ReactDOMServer from 'react-dom/server'
import ConsoleController from './ConsoleController'
import { verifyThemePropTypes, verifyMissingProps, debounce } from './util'


function defaultBreadboardRequire(name) {
  if (name === 'react') {
    return React
  }
}

function defaultRenderToString(source, require, console, props) {
  try {
    var execute
    var exports = {}
    var module = { exports: exports }
    eval('execute = function execute(module, exports, require, console) { '+source+' }')
    execute(module, exports, require, console)
    const component = exports.default
    return ReactDOMServer.renderToString(React.createElement(component, props))
  }
  catch (err) {
    return err
  }
}

function defaultPrepare(source, require, console) {
  try {
    var execute
    var exports = {}
    var module = { exports: exports }
    eval('execute = function execute(module, exports, require, console) { '+source+' }')
    execute(module, exports, require, console)
    const component = exports.default

    return (mount, props={}) => {
      if (component) {
        try {
          ReactDOM.render(
            React.createElement(component, props),
            mount
          )
        }
        catch (err) {
          return err
        }
      }
    }
  }
  catch (err) {
    return () => err
  }
}


class BreadboardResizeObserver {
  constructor() {
    this.callbacks = new WeakMap
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const callback = this.callbacks.get(entry.target)

        if (callback) {
          callback({
            height: entry.contentRect.height,
            width: entry.contentRect.width,
          })
        }
      }
    })
  }

  observe(target, callback) {
    this.observer.observe(target)
    this.callbacks.set(target, callback)
  }

  unobserve(target, callback) {
    this.observer.unobserve(target)
    this.callbacks.delete(target, callback)
  }
}

const breadboardResizeObserver = new BreadboardResizeObserver


export default class Breadboard extends Component {
  static propTypes = {
    /**
     * A string containing the original source. Updates to the source will
     * be stored in component state. Updates to `defaultSource` will not be
     * reflected once the source has undergone any change.
     */
    defaultSource: PropTypes.string.isRequired,

    /**
     * Allows for fixing the breadboard's height.
     */
    height: PropTypes.number,

    /**
     * A Controller object that keeps track of the current visible modes.
     * Breadboard will only compile and/or execute code when it is required.
     */
    modesController: PropTypes.object.isRequired,

    /**
     * A function that takes the transformed source and returns a function
     * that can be used to render a value from the controller to the mount.
     */
    prepare: PropTypes.func.isRequired,

    /**
     * A controller whose state will be injected into the preview element's
     * props. If non-existent, we'll assume that our source calls render
     * manually.
     */
    viewController: PropTypes.object,

    /**
     * Allows you to configure the editor component. Accepts a function that
     * takes a `{ layout, value, onChange }`, and returns an editor element.
     */
    renderEditorElement: PropTypes.func.isRequired,

    /**
     * An optional function that renders the source with a given controller
     * state to a string suitable for use with server side rendering.
     */
    renderToString: PropTypes.func,

    /**
     * The function that will be used to handle CommonJS `require()` calls
     * within the evaluated code. Defaults to a function that only provides
     * the `react` module.
     */
    require: PropTypes.func,

    /**
     * A function that renders the breadboard given a set of state and
     * event handlers.
     */
    theme: PropTypes.func.isRequired,

    /**
     * A function that transforms the source before evaluating it.
     *
     * Transform functions are often pretty heavy, so we don't include anything
     * by default.
     */
    transform: PropTypes.func,

    /**
     * Allows for fixing the breadboard's width.
     */
    width: PropTypes.number,
  }

  static defaultProps = {
    prepare: defaultPrepare,
    renderToString: defaultRenderToString,
    require: defaultBreadboardRequire,
  }

  constructor(props) {
    super(props)

    const source = props.defaultSource.replace(/^\n|\n$/g, '')
    const { width, height } = props

    this.consoleController = createController(ConsoleController)
    this.consoleController.thaw()
    this.fakeConsole = this.consoleController.get().actions

    this.debouncedChangeSource = debounce(this.changeSource, 100)

    this.dimensions = { width, height }

    this.viewController = props.viewController

    this.modesController = props.modesController
    this.modesController.setDimensions(this.dimensions)

    const modes = this.modesController.modes

    this.state = {
      consoleMessages: [],
      source: source,
      editorSource: source,
      value: null,
      modes: modes,
      transformedSource: null,
      executableSource: null,
      transformError: null,
      renderer: null,
      executionError: null,
    }

    if (ExecutionEnvironment.canUseDOM &&
        props.viewController) {
      props.viewController.subscribe(this.handleViewUpdate)
    }

    const execute = modes.view || modes.console

    if (modes.transformed || execute) {
      const { transformedSource, executableSource, error } = this.props.transform(source)

      this.state.transformedSource = transformedSource
      this.state.executableSource = executableSource
      this.state.transformError = error

      if (execute && executableSource) {
        if (props.renderToString) {
          this.state.string = props.renderToString(
            executableSource,
            props.require,
            this.fakeConsole,
            props.viewController && props.viewController.get()
          )
        }
        if (ExecutionEnvironment.canUseDOM) {
          this.fakeConsole.clear()
          this.state.renderer = props.prepare(
            executableSource,
            props.require,
            this.fakeConsole,
          )
        }
      }
    }

    this.state.consoleMessages = this.consoleController.get().messages
  }

  componentDidMount() {
    this.modesController.subscribe(this.handleModesChange)
    this.consoleController.subscribe(this.handleConsoleChange)

    this.manageDimensions(this.props)

    // Use this instead of the `modes` on state, as if the above
    // manageDimensions call has caused a change, it may not have
    // propagated through to `this.state` yet.
    if (this.modesController.modes.view) {
      const viewController = this.props.viewController
      this.execute(viewController && viewController.get())
    }
  }
  componentWillReceiveProps(nextProps) {
    if (nextProps.modesController !== this.modesController) {
      console.warn('Breadboard does not currently support changes to the `modesController` prop!')
    }
    if (nextProps.viewController !== this.viewController) {
      console.warn('Breadboard does not currently support changes to the `viewController` prop!')
    }

    this.manageDimensions(nextProps)

    if (nextProps.transform !== this.props.transform ||
        nextProps.prepare !== this.props.prepare ||
        nextProps.require !== this.props.require) {
      this.setState(this.transformAndPrepare(this.state.source, nextProps) || {})
    }
  }
  componentDidUpdate(prevProps, prevState) {
    const modes = this.state.modes
    if ((modes.view || modes.console) && 
        (this.state.renderer !== prevState.renderer ||
         !(prevState.modes.view || prevState.modes.console))) {
      try {
        ReactDOM.unmountComponentAtNode(this.refs.mount)
      }
      catch (e) { }
      const viewController = this.viewController
      this.execute(viewController && viewController.get())
    }
  }
  componentWillUnmount() {
    if (this.resizeObserver) {
      this.destroyResizeObserver()
    }

    this.modesController.unsubscribe(this.handleModesChange)
    this.consoleController.destroy()

    try {
      ReactDOM.unmountComponentAtNode(this.refs.mount)
    } catch (e) { }
  }

  handleResize = (dimensions, props={}) => {
    const forcedDimensions = {
      height: props.height === undefined ? dimensions.height : props.height,
      width: props.width === undefined ? dimensions.width : props.width,
    }

    this.dimensions = forcedDimensions
    this.modesController.setDimensions(forcedDimensions)
  }

  handleModesChange = (modes) => {
    const prevModes = this.state.modes
    const prevExecute = prevModes.view || prevModes.console
    const nextExecute = modes.view || modes.console
    const updates = { modes }
    if ((!prevModes.transformed && modes.transformed) || (!prevExecute && nextExecute)) {
      Object.assign(updates, this.transformAndPrepare(this.state.source, this.props))
    }
    this.setState(updates)
  }

  // Used so to create debouncedChangeSource. This is separate to the event handler
  // as React doesn't like us keeping the event objects around for the completion of
  // the timeout.
  changeSource = (source) => {
    if (source !== this.state.source) {
      this.setState({
        source,
        ...this.transformAndPrepare(source, this.props)
      })
    }
  }

  handleChangeSource = (e) => {
    const source = typeof e === 'string' ? e : (e && e.target && e.target.value)
    this.setState({ editorSource: source })
    this.debouncedChangeSource(source)
  }

  handleConsoleChange = ({ messages }) => {
    this.setState({
      consoleMessages: messages
    })
  }

  handleViewUpdate = (viewProps) => {
    if (this.state.modes.view || this.state.modes.console) {
      this.execute(viewProps)
    }
  }

  renderEditorElement = (themeableProps={}) => {
    if (process.env.NODE_ENV !== 'production') {
      // Editor components are complicated beings, and probably will feel the
      // same way about being "styled" as a dog feels about taking a bath.
      //
      // If you want to theme your editor, you'll need to do so by passing in
      // an already themed editor. The only condition is that it accepts
      // layout styles via `style`, a `value` with the current source, and an
      // `onChange` callback that notifies us of a new value.
      verifyThemePropTypes(themeableProps, {
        layout: true,
      })
    }

    return this.props.renderEditorElement({
      layout: themeableProps.layout,
      value: this.state.editorSource,
      onChange: this.handleChangeSource,
    })
  }

  renderMountElement = (themeableProps={}) => {
    if (process.env.NODE_ENV !== 'production') {
      verifyMissingProps(themeableProps, [
        'children',
        'style',
      ])
    }

    const { layout, ...other } = themeableProps

    return React.cloneElement(this.mountElement, {
      ...other,
      style: layout
    })
  }

  render() {
    // Generate the mount elememnt here to ensure that the ref attaches to
    // this component instance
    this.mountElement =
      ExecutionEnvironment.canUseDOM
       ? <div ref='mount' />
       : <div ref='mount' dangerouslySetInnerHTML={{__html: this.state.string}} />

    const rootElement = this.props.theme({
      consoleMessages: this.state.consoleMessages,
      transformedSource: this.state.transformedSource,
      transformError: this.state.transformError,
      executionError: this.state.executionError,

      renderEditorElement: this.renderEditorElement,
      renderMountElement: this.renderMountElement,

      modes: this.state.modes,
      modeActions: this.modesController.actions,
    })

    return React.cloneElement(rootElement, { ref: this.setRootElement })
  }

  setRootElement = (el) => {
    this.rootElement = el
  }

  transformAndPrepare(source, props) {
    const state = this.state
    const modes = this.modesController.modes
    const execute = modes.view || modes.console

    if (execute || modes.transformed) {
      const { transformedSource, executableSource, error } = props.transform(source)
      this.fakeConsole.clear()

      if (transformedSource !== state.transformedSource ||
          executableSource !== state.executableSource ||
          error !== state.transformError) {

        const result = {
          transformError: error,
          transformedSource,
          executableSource,
        }

        if (execute && executableSource) {
          result.executionError = null
          result.renderer = props.prepare(
            executableSource,
            props.require,
            this.fakeConsole,
          )
        }

        return result
      }
    }
  }

  execute(viewProps) {
    if (this.state.renderer) {
      const executionError = this.state.renderer(this.refs.mount, viewProps || {})
      if (executionError) {
        this.setState({ executionError })
      }
    }
  }

  manageDimensions(props) {
    const oldDimensions = this.dimensions
    let newDimensions

    if (props.width !== undefined && props.height !== undefined) {
      if (this.resizeObserver) {
        this.destroyResizeObserver()
      }
    }
    else {
      breadboardResizeObserver.observe(this.rootElement, this.handleResize)

      const rect = this.rootElement.getBoundingClientRect()
      newDimensions = {
        height: rect.height,
        width: rect.width,
      }
    }

    if (newDimensions && (newDimensions.width !== oldDimensions.width || newDimensions.height !== oldDimensions.height)) {
      this.handleResize(newDimensions, props)
    }
  }
  
  destroyResizeObserver() {
    breadboardResizeObserver.unobserve(this.rootElement, this.handleResize)
  }
}
