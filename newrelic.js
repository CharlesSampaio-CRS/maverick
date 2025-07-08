'use strict'

/**
 * New Relic agent configuration.
 *
 * See lib/config/default.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  /**
   * Array of application names.
   */
  app_name: ['NovaDAX Bot API'],
  /**
   * Your New Relic license key.
   */
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  /**
   * This setting controls distributed tracing.
   * Distributed tracing lets you see the path that a request takes through your
   * distributed system. Enabling distributed tracing changes the behavior of some
   * New Relic features, so carefully consult the transition guide before you enable
   * this feature: https://docs.newrelic.com/docs/transition-guide-distributed-tracing
   * Default is true.
   */
  distributed_tracing: {
    /**
     * Enables/disables distributed tracing.
     *
     * @env NEW_RELIC_DISTRIBUTED_TRACING_ENABLED
     */
    enabled: true
  },
  logging: {
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: 'info'
  },
  /**
   * When true, all request headers except for those listed in attributes.exclude
   * will be captured for all traces, unless otherwise specified in a destination's
   * attributes include/exclude lists.
   */
  allow_all_headers: true,
  attributes: {
    /**
     * Prefix of attributes to exclude from all destinations. Allows * as wildcard
     * at end of prefix.
     *
     * NOTE: If excluding headers, they must be in camelCase form to be filtered.
     *
     * @env NEW_RELIC_ATTRIBUTES_EXCLUDE
     */
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*'
    ]
  },
  /**
   * Transaction tracer enables capture of detailed timing information for
   * transactions.
   */
  transaction_tracer: {
    /**
     * Transaction tracer is enabled by default. Set to false to disable.
     */
    enabled: true,
    /**
     * Transaction threshold in seconds for when to collect stack trace.
     */
    transaction_threshold: 5.0,
    /**
     * Boolean flag for whether or not to collect stack traces when the transaction
     * threshold is met.
     */
    record_sql: 'obfuscated',
    /**
     * Set to false to disable stack traces in transaction traces. This will
     * prevent the transaction tracer from collecting call stack information for
     * each traced transaction.
     */
    stack_trace_threshold: 0.5,
    /**
     * Explain plan threshold in seconds. Queries slower than this threshold will
     * have their explain plan captured automatically. The explain plan data will
     * be available in the transaction trace detail view. Defaults to 0.5 seconds.
     */
    explain_threshold: 0.5
  },
  /**
   * Error collector captures and reports errors that occur in your application.
   */
  error_collector: {
    /**
     * Error collector is enabled by default. Set to false to disable.
     */
    enabled: true,
    /**
     * List of error messages to specifically ignore. Can be exact strings or
     * regular expressions.
     */
    ignore_errors: []
  },
  /**
   * Slow query logging enables capture of slow queries with explain plans.
   */
  slow_sql: {
    /**
     * Slow query logging is enabled by default. Set to false to disable.
     */
    enabled: true,
    /**
     * The agent will collect slow queries that take longer than this many seconds.
     */
    explain_threshold: 0.5
  },
  /**
   * Browser monitoring gives you insight into the performance real users are
   * experiencing with your website. This is Real User Monitoring (RUM).
   */
  browser_monitoring: {
    /**
     * Browser monitoring is disabled by default. Set to true to enable.
     */
    enabled: false
  },
  /**
   * Host display name
   */
  process_host: {
    display_name: process.env.NEW_RELIC_PROCESS_HOST_DISPLAY_NAME || 'NovaDAX Bot API'
  }
} 