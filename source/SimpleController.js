import { Controller } from './Controllers'


export default class SimpleController extends Controller {
  constructor(env) {
    this.$env = env
    this.$isDestroyed = false
    this.$listeners = []
    this.$state = Object.assign({}, this.constructor.initialState)

    this.$runningActions = {}
    this.$runningEnv = false

    this.$transactionLevel = 0

    this.$actions = {}
    const actionTemplates = this.constructor.actions
    const actionKeys = Object.keys(actionTemplates)
    for (let key of actionKeys) {
      this.$actions[key] = this.$doAction.bind(this, key, actionTemplates[key])
    }
    Object.freeze(this.$actions)
  }


  //
  // Internal API
  //

  get actions()   { return this.$actions }
  get env()       { return this.$env }
  get state()     { return this.$state }

  setState(state) {
    if (this.$isDestroyed) {
      console.error('You cannot call `setState` on a controller instance that has been destroyed. Skipping setState.')
      return
    }

    if (this.$doStateUpdate(state)) {
      this.$doIncreaseTransactionLevel()
      this.$doNotify()
      this.$doDecreaseTransactionLevel()
    }
  }


  //
  // Overridable by subclass
  //

  doesEnvDiffer(env) {
    return true
  }

  doesStateDiffer(state) {
    return true
  }

  output() {
    return {
      ...this.env,
      state: this.state,
      actions: this.actions,
    }
  }

  //
  // Implementation details
  //

  $isRunning() {
    return (
      this.$runningEnv ||
      Object.keys(this.$runningActions).length > 0
    )
  }

  $doAction(key, fn, ...args) {
    if (this.$isDestroyed) {
      console.error('You cannot call actions on a controller instance that has been destroyed.')
      return
    }
    if (this.$runningActions[key]) {
      console.error(`Stubbornly refusing to start running action ${key} that is already running on the same instance. If you reall want to recurse, separate your recursion into a separate function.`)
      return
    }

    this.$doIncreaseTransactionLevel()

    this.$runningActions[key] = true
    fn.apply(this, args)
    delete this.$runningActions[key]
    if (this.$notificationIsQueued) {
      this.$doNotify()
    }

    this.$doDecreaseTransactionLevel()
  }

  // This actually performs the env update. It assumes that all conditions to
  // perform an env update have been met.
  $doEnvUpdate(env) {
    if (this.doesEnvDiffer(env)) {
      let didStateChange = false
      if (!this.$runningEnv && this.envWillUpdate) {
        const oldState = this.$state
        this.$runningEnv = true
        this.envWillUpdate(env)
        this.$runningEnv = false
        didStateChange = this.doesStateDiffer(oldState)
      }
      this.$env = env
      return [true, didStateChange]
    }
    return [false, false]
  }

  $doStateUpdate(state) {
    if (this.doesStateDiffer(state)) {
      this.$state = Object.freeze(state)
      return true
    }
  }

  $doNotify() {
    if (!this.$isRunning()) {
      const output = this.output()
      for (let { change } of this.$listeners) {
        change(output)
      }
      this.$notificationIsQueued = false
    }
    else {
      this.$notificationIsQueued = true
    }
  }

  $doIncreaseTransactionLevel() {
    if (++this.$transactionLevel == 1) {
      for (let { transactionStart } of this.$listeners) {
        transactionStart()
      }
    }
  }

  $doDecreaseTransactionLevel() {
    if (--this.$transactionLevel == 0) {
      for (let { transactionEnd } of this.$listeners) {
        transactionEnd()
      }
    }
  }


  //
  // Public API
  //

  $$set(env) {
    if (this.$isDestroyed) {
      console.error('You cannot call `set` on a controller instance that has been destroyed. Skipping.')
      return
    }

    this.$doIncreaseTransactionLevel()
    const [didEnvChange, didStateChange] = this.$doEnvUpdate(env)
    if (didEnvChange) {
      this.$doNotify()
    }
    this.$doDecreaseTransactionLevel()
  }

  $$get() {
    return this.output()
  }

  $$subscribe(change, transactionStart, transactionEnd) {
    const callbacks = { change, transactionStart, transactionEnd }
    this.$listeners.push(callbacks)
    return () => {
      const index = this.$listeners.indexOf(callbacks)
      if (index !== -1) {
        this.$listeners.splice(index, 1)
      }
    }
  }

  $$destroy() {
    this.$listeners.length = 0
    this.$isDestroyed = true
  }
}
