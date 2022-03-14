const chalk = require('chalk')
const axios = require('axios')
const Storyblok = require('storyblok-js-client')
const inquirer = require('inquirer')

const creds = require('./creds')
const getQuestions = require('./get-questions')
const { LOGIN_URL, USER_INFO, SIGNUP_URL, API_URL } = require('../constants')

module.exports = {
  accessToken: '',
  spaceId: null,

  getClient () {
    const sb = new Storyblok({
      oauthToken: this.accessToken
    }, API_URL)
    // In the current storyblok-js-client the response interceptor is not returning error codes. #workaround
    sb.client.interceptors.response.use((res) => {
      return res
    }, (error) => {
      if (error.response.status === 401) {
        this.logout(true)
      }
      return Promise.reject(error)
    })
    return sb
  },

  getPath (path) {
    if (this.spaceId) {
      return `spaces/${this.spaceId}/${path}`
    }

    return path
  },

  async login (email, password) {
    try {
      const response = await axios.post(LOGIN_URL, {
        email: email,
        password: password
      })

      const { data } = response

      if (data.otp_required) {
        const questions = [
          {
            type: 'input',
            name: 'otp_attempt',
            message: 'We sent a code to your email / phone, please insert the authentication code:',
            validate (value) {
              if (value.length > 0) {
                return true
              }

              return 'Code cannot blank'
            }
          }
        ]

        const { otp_attempt: code } = await inquirer.prompt(questions)

        const newResponse = await axios.post(LOGIN_URL, {
          email: email,
          password: password,
          otp_attempt: code
        })

        return this.persistCredentials(email, newResponse.data || {})
      }

      return this.persistCredentials(email, data)
    } catch (e) {
      return Promise.reject(e)
    }
  },

  async getUser () {
    try {
      const { data } = await axios.get(USER_INFO, {
        headers: {
          Authorization: this.accessToken
        }
      })
      return data.user
    } catch (e) {
      this.logoutIfUnauthorized(e)
      return undefined
    }
  },

  persistCredentials (email, data) {
    const token = this.extractToken(data)
    if (token) {
      this.accessToken = token
      creds.set(email, token)

      return Promise.resolve(data)
    }
    return Promise.reject(new Error('The code could not be authenticated.'))
  },

  async processLogin () {
    try {
      const questions = getQuestions('login')
      const { email, password } = await inquirer.prompt(questions)

      const data = await this.login(email, password)

      console.log(chalk.green('✓') + ' Log in successfully! Token has been added to .netrc file.')

      return Promise.resolve(data)
    } catch (e) {
      if (e.response && e.response.data && e.response.data.error) {
        console.error(chalk.red('X') + ' An error ocurred when login the user: ' + e.response.data.error)

        return Promise.reject(e)
      }

      console.error(chalk.red('X') + ' An error ocurred when login the user')
      return Promise.reject(e)
    }
  },

  extractToken (data) {
    return data.access_token
  },

  logout (unauthorized) {
    if (creds.get().email && unauthorized) {
      console.log(chalk.red('X') + ' Your login seems to be expired, we logged you out. Please log back in again.')
    }
    creds.set(null)
  },

  signup (email, password) {
    return axios.post(SIGNUP_URL, {
      email: email,
      password: password
    })
      .then(response => {
        const token = this.extractToken(response)
        this.accessToken = token
        creds.set(email, token)

        return Promise.resolve(true)
      })
      .catch(err => Promise.reject(err))
  },

  isAuthorized () {
    const { token } = creds.get() || {}

    if (token) {
      this.accessToken = token
      return true
    }

    return false
  },

  setSpaceId (spaceId) {
    this.spaceId = spaceId
  },

  getPresets () {
    const client = this.getClient()

    return client
      .get(this.getPath('presets'))
      .then(data => data.data.presets || [])
      .catch(err => Promise.reject(err))
  },

  getComponents () {
    const client = this.getClient()

    return client
      .get(this.getPath('components'))
      .then(data => data.data.components || [])
      .catch(err => Promise.reject(err))
  },

  getComponentGroups () {
    const client = this.getClient()

    return client
      .get(this.getPath('component_groups'))
      .then(data => data.data.component_groups || [])
      .catch(err => Promise.reject(err))
  },

  post (path, props) {
    return this.sendRequest(path, 'post', props)
  },

  put (path, props) {
    return this.sendRequest(path, 'put', props)
  },

  get (path, options = {}) {
    return this.sendRequest(path, 'get', options)
  },

  getStories (params = {}) {
    const client = this.getClient()
    const _path = this.getPath('stories')

    return client.getAll(_path, params)
  },

  getSingleStory (id, options = {}) {
    const client = this.getClient()
    const _path = this.getPath(`stories/${id}`)

    return client.get(_path, options)
      .then(response => response.data.story || {})
  },

  delete (path) {
    return this.sendRequest(path, 'delete')
  },

  sendRequest (path, method, props = {}) {
    const client = this.getClient()
    const _path = this.getPath(path)

    return client[method](_path, props)
  },

  async getAllSpaces () {
    return await this.getClient()
      .get('spaces/', {})
      .then(res => res.data.spaces || [])
      .catch(err => Promise.reject(err))
  }
}
