/*
 * Tools for working with controllers.
 *
 * Controller Classes are classes with the following interface:
 *
 *     type Unsubscriber = () => void;
 *
 *     abstract class Controller<I, O> {
 *       constructor(input: I);
 *
 *       $set(input: I): void;
 *       $get(): O;
 *
 *       $subscribe(
 *         onChange: (output: O) => void,
 *         onTransactionStart: () => void,
 *         onTransactionEnd: () => void
 *       ): Unsubscriber;
 *
 *       $destroy(): void;
 *     }
 */

import React, { Component } from 'react'
import hoistNonReactStatics from 'hoist-non-react-statics'
import ExecutionEnvironment from 'exenv'
import compose from './compose'
import withDefaultProps from './withDefaultProps'


const IS_CONTROLLER = {}


export class Controller {}


export function instantiateController(type, value) {
  if (!(type.prototype instanceof Controller))  {
    throw new Error(`instantiateController: expected first argument to be a class that extends "Controller", but received "${type}" instead.`)
  }

  const instance = new type(value)

  const controller = {
    set: instance.$set.bind(instance),
    get: instance.$get.bind(instance),
    subscribe: instance.$subscribe.bind(instance),
    destroy: instance.$destroy.bind(instance),
  }

  Object.defineProperty(controller, '$isController', {
    value: IS_CONTROLLER,
  })

  return Object.freeze(controller)
}


/**
 * Returns true if the argument object is an instance of `Controller`
 */
export function isController(obj) {
  return obj && obj.$isController === IS_CONTROLLER
}


/**
 * Create and destroy controllers of the supplied typey when
 * necessary, and then destroy them when no longer needed.
 *
 * In the case a single function is provided, the created controller
 * will be placed on the `controller` prop.
 */
export function instantiateDefaultControllers(controllerClasses) {
  const isSingleton = typeof controllerClasses == 'function'

  if (isSingleton) {
    controllerClasses = { controller: controllerClasses }
  }

  const keys = Object.keys(controllerClasses)
  if (keys.length === 0) {
    console.warning("instantiateDefaultControllers: called without any classes")
  }
  for (let key of keys) {
    if (!(controllerClasses[key].prototype instanceof Controller))  {
      throw new Error(`instantiateDefaultControllers: expected a class that extends "Controller" for key "${key}", but received "${controllerClasses[key]}" instead.`)
    }
  }

  function createMissingControllers(props) {
    const created = {}

    for (let key of keys) {
      if (props[key] === undefined) {
        const ControllerClass = controllerClasses[key]
        created[key] = new ControllerClass(props)
      }
    }

    return created
  }

  return WrappedComponent => {
    class InstantiateDefaultControllers extends Component {
      constructor(props) {
        super(props)

        this.state = {
          defaults: createMissingControllers(props),
        }
      }

      componentWillReceiveProps(nextProps) {
        for (let key of Object.keys(this.state.defaults)) {
          if (nextProps[key] !== undefined) {
            this.state.defaults[key].destroy()
            delete this.state.defaults[key]
          }
        }

        const merged = { ...nextProps, ...this.state.defaults }
        this.setState({
          defaults: Object.assign(merged, createMissingControllers(merged))
        })
      }

      componentWillUnmount() {
        for (let key of Object.keys(this.state.defaults)) {
          this.state.defaults[key].destroy()
          delete this.state.defaults[key]
        }
      }

      render() {
        return React.createElement(WrappedComponent, {
            ...this.props,
            ...this.state.defaults
        })
      }
    }

    hoistNonReactStatics(InstantiateDefaultControllers, WrappedComponent)

    return InstantiateDefaultControllers
  }
}


/**
 * Inject the provided controller or controllers into the component on every
 * render.
 *
 * In the case a single function is provided, the created controller
 * will be placed on the `controller` prop.
 */
export function injectControllers(controllers) {
  const isSingleton = isController(controllers)

  if (isSingleton) {
    controllers = { controller: controllers }
  }

  const keys = Object.keys(controllers)
  if (keys.length === 0) {
    console.warning("injectControllers: called without any classes")
  }
  for (let key of keys) {
    if (!isController(controllers[key]))  {
      throw new Error(`injectControllers: expected a controller fror key "${key}", but received "${controllers[key]}" instead.`)
    }
  }

  return withDefaultProps(controllers)
}


// The `controlledBy` decorator links its argument controllers' inputs to the
// props of the associated component.
//
// It wouldn't makes sense for a single controller to receive the input of two
// components. With this in mind, components used with `controlledBy` are
// added to this registry so that a warning can be made if they're used twice.
const globalLinkedControllers = new WeakMap

/**
 * Subscribe to one or more controllers while the component, feeding the
 * component props into the controllers as input.
 *
 * If a single prop name is passed in, the controller's output will be
 * injected directly onto the component's props. If an array of prop names is
 * passed in, each controller's output will be injected on a prop with
 * matching name.
 */
export function controlledByProps(controllerPropNames) {
  const isSingleton = !Array.isArray(controllerPropNames) && controllerPropNames

  if (isSingleton) {
    controllerPropNames = [controllerPropNames]
  }

  if (controllerPropNames.indexOf('$flush') !== -1) {
    throw new Error('controllerPropNames: The controller name `$flush` is reserved.')
  }

  return WrappedComponent => {
    class ControlledByProps extends Component {
      constructor(props) {
        super(props)

        this.state = {}
        this.unsubscribers = {}
        this.flushLevel = 0
        this.transactionLevel = 0
      }

      componentWillMount() {
        const outputs = {}
        for (let key of controllerPropNames) {
          const controller = this.props[key]
          if (controller) {
            outputs[key] = this.subscribe(key, controller, this.props)
          }
        }
        this.setState(outputs)
      }

      componentWillReceiveProps(nextProps) {
        const newOutputs = {}
        let haveNewOutputs = false

        for (let key of controllerPropNames) {
          const prevController = this.props[key]
          const nextController = nextProps[key]

          if (prevController && (!nextController || nextController !== prevController)) {
            this.unsubscribe(key, prevController)
            newOutputs[key] = null
            haveNewOutputs = true
          }
          if (nextController) {
            if (nextController !== prevController) {
              newOutputs[key] = this.subscribe(key, nextController, nextProps)
              haveNewOutputs = true
            }
            else {
              // TODO
              // This can cause the props fed into this component to change,
              // and I *believe* this will queue another
              // componentWillReceiveProps for later instead of nested calls.
              // I need to confirm this.
              // This can also cause calls to `handleChange`, but this is fine
              // as it will already complain if transaction level is 0.
              controller.set(nextProps)
            }
          }
        }

        if (haveNewOutputs) {
          this.setState(newOutputs)
        }
      }

      componentWillUnmount() {
        for (let key of controllerPropNames) {
          const controller = this.props[key]
          if (controller) {
            this.unsubscribe(key, controller)
          }
        }
      }

      shouldComponentUpdate() {
        return this.transactionLevel === 0
      }

      render() {
        const inject = isSingleton ? this.state.outputs[isSingleton] : this.state.outputs

        return React.createElement(WrappedComponent, {
          ...this.props,
          ...inject,
        })
      }

      subscribe(key, controller, props) {
        controller.set(props)

        if (ExecutionEnvironment.canUseDOM) {
          const otherKey = globalLinkedControllers.get(controller)
          if (otherKey) {
            console.warn(`controlledBy: A controller has been mounted twice, with the keys "${key}" and "${otherKey}".`)
          }
          globalLinkedControllers.set(controller, key)

          this.unsubscribers[key] = controller.subscribe(
            this.handleChange.bind(this, key),
            this.handleTransactionStart,
            this.handleTransactionEnd
          )
        }

        return controller.get()
      }

      unsubscribe(key, controller) {
        globalLinkedControllers.delete(controller)
        const unsubscriber = this.unsubscribers[key]
        if (unsubscriber) {
          unsubscriber()
          delete this.unsubscribers[key]
        }
      }

      handleChange(key, newState) {
        if (this.transactionLevel === 0) {
          throw new Error('controlledBy: A Controller may not emit a change without first starting a transaction.')
        }
        if (this.flushLevel !== 0) {
          throw new Error('controlledBy: A Controller may not change its output while flushing changes to the component.')
        }

        this.setState({
          [key]: newState,
        })
      }

      handleTransactionStart = () => {
        ++this.transactionLevel

        // If we're flushing when the transaction starts, we want to make sure
        // that the transaction finishes before any more changes occur, even
        // if the transaction doesn't finish until after the flush completes.
        //
        // This helps to ensure we don't get async infinite loops.
        if (this.flushLevel > 0) {
          ++this.flushLevel
        }
      }

      handleTransactionEnd(key) {
        --this.transactionLevel

        // The flush level can only be positive if the transaction was started
        // during a flush
        if (this.flushLevel > 0) {
          --this.flushLevel
        }

        if (--this.transactionLevel === 0) {
          ++this.flushLevel
          this.setState({ $flush: {} }, () => {
            --this.flushLevel
          })
        }
      }
    }

    hoistNonReactStatics(ControlledBy, WrappedComponent)

    return ControlledBy
  }
}


export const controlled = controlledByProps('controller')
export const controlledBy = controllerClasses => Component =>
  compose(
    instantiateDefaultControllers(controllerClasses),
    controlledByProps(typeof controllerClasses == 'function' ? 'controller' : Object.keys(controllerClasses))
  )(Component)