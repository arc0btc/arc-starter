# Arc State Machine

*Generated: 2026-03-18T23:38:57.627Z*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
    }

    state SensorsService {
        [*] --> RunAllSensors: parallel via Promise.allSettled
        RunAllSensors --> agent_hubSensor: agent-hub
        RunAllSensors --> aibtc_dev_opsSensor: aibtc-dev-ops
        RunAllSensors --> aibtc_heartbeatSensor: aibtc-heartbeat
        RunAllSensors --> aibtc_inbox_syncSensor: aibtc-inbox-sync
        RunAllSensors --> aibtc_news_deal_flowSensor: aibtc-news-deal-flow
        RunAllSensors --> aibtc_news_editorialSensor: aibtc-news-editorial
        RunAllSensors --> aibtc_repo_maintenanceSensor: aibtc-repo-maintenance
        RunAllSensors --> aibtc_welcomeSensor: aibtc-welcome
        RunAllSensors --> albSensor: alb
        RunAllSensors --> arc_alive_checkSensor: arc-alive-check
        RunAllSensors --> arc_architecture_reviewSensor: arc-architecture-review
        RunAllSensors --> arc_blocked_reviewSensor: arc-blocked-review
        RunAllSensors --> arc_catalogSensor: arc-catalog
        RunAllSensors --> arc_ceo_reviewSensor: arc-ceo-review
        RunAllSensors --> arc_cost_reportingSensor: arc-cost-reporting
        RunAllSensors --> arc_dispatch_evalSensor: arc-dispatch-eval
        RunAllSensors --> arc_email_syncSensor: arc-email-sync
        RunAllSensors --> arc_failure_triageSensor: arc-failure-triage
        RunAllSensors --> arc_housekeepingSensor: arc-housekeeping
        RunAllSensors --> arc_introspectionSensor: arc-introspection
        RunAllSensors --> arc_memorySensor: arc-memory
        RunAllSensors --> arc_monitoring_serviceSensor: arc-monitoring-service
        RunAllSensors --> arc_opensourceSensor: arc-opensource
        RunAllSensors --> arc_ops_reviewSensor: arc-ops-review
        RunAllSensors --> arc_paymentsSensor: arc-payments
        RunAllSensors --> arc_report_emailSensor: arc-report-email
        RunAllSensors --> arc_reportingSensor: arc-reporting
        RunAllSensors --> arc_reputationSensor: arc-reputation
        RunAllSensors --> arc_schedulerSensor: arc-scheduler
        RunAllSensors --> arc_self_auditSensor: arc-self-audit
        RunAllSensors --> arc_service_healthSensor: arc-service-health
        RunAllSensors --> arc_skill_managerSensor: arc-skill-manager
        RunAllSensors --> arc_starter_publishSensor: arc-starter-publish
        RunAllSensors --> arc_strategy_reviewSensor: arc-strategy-review
        RunAllSensors --> arc_umbrelSensor: arc-umbrel
        RunAllSensors --> arc_workflow_reviewSensor: arc-workflow-review
        RunAllSensors --> arc_workflowsSensor: arc-workflows
        RunAllSensors --> arc0btc_pr_reviewSensor: arc0btc-pr-review
        RunAllSensors --> arc0btc_security_auditSensor: arc0btc-security-audit
        RunAllSensors --> arc0btc_site_healthSensor: arc0btc-site-health
        RunAllSensors --> arxiv_researchSensor: arxiv-research
        RunAllSensors --> auto_queueSensor: auto-queue
        RunAllSensors --> bitcoin_quorumclawSensor: bitcoin-quorumclaw
        RunAllSensors --> bitflowSensor: bitflow
        RunAllSensors --> blog_deploySensor: blog-deploy
        RunAllSensors --> blog_publishingSensor: blog-publishing
        RunAllSensors --> compliance_reviewSensor: compliance-review
        RunAllSensors --> contactsSensor: contacts
        RunAllSensors --> context_reviewSensor: context-review
        RunAllSensors --> defi_bitflowSensor: defi-bitflow
        RunAllSensors --> defi_compoundingSensor: defi-compounding
        RunAllSensors --> defi_stacks_marketSensor: defi-stacks-market
        RunAllSensors --> defi_zestSensor: defi-zest
        RunAllSensors --> erc8004_indexerSensor: erc8004-indexer
        RunAllSensors --> erc8004_reputationSensor: erc8004-reputation
        RunAllSensors --> fleet_commsSensor: fleet-comms
        RunAllSensors --> fleet_dashboardSensor: fleet-dashboard
        RunAllSensors --> fleet_escalationSensor: fleet-escalation
        RunAllSensors --> fleet_healthSensor: fleet-health
        RunAllSensors --> fleet_log_pullSensor: fleet-log-pull
        RunAllSensors --> fleet_memorySensor: fleet-memory
        RunAllSensors --> fleet_rebalanceSensor: fleet-rebalance
        RunAllSensors --> fleet_routerSensor: fleet-router
        RunAllSensors --> fleet_self_syncSensor: fleet-self-sync
        RunAllSensors --> fleet_syncSensor: fleet-sync
        RunAllSensors --> github_ci_statusSensor: github-ci-status
        RunAllSensors --> github_interceptorSensor: github-interceptor
        RunAllSensors --> github_issue_monitorSensor: github-issue-monitor
        RunAllSensors --> github_issuesSensor: github-issues
        RunAllSensors --> github_mentionsSensor: github-mentions
        RunAllSensors --> github_release_watcherSensor: github-release-watcher
        RunAllSensors --> github_security_alertsSensor: github-security-alerts
        RunAllSensors --> github_worker_logsSensor: github-worker-logs
        RunAllSensors --> identity_guardSensor: identity-guard
        RunAllSensors --> mempool_watchSensor: mempool-watch
        RunAllSensors --> site_consistencySensor: site-consistency
        RunAllSensors --> skill_effectivenessSensor: skill-effectiveness
        RunAllSensors --> social_agent_engagementSensor: social-agent-engagement
        RunAllSensors --> social_x_ecosystemSensor: social-x-ecosystem
        RunAllSensors --> social_x_postingSensor: social-x-posting
        RunAllSensors --> stacks_stackspotSensor: stacks-stackspot
        RunAllSensors --> systems_monitorSensor: systems-monitor
        RunAllSensors --> worker_deploySensor: worker-deploy
        RunAllSensors --> worker_logs_monitorSensor: worker-logs-monitor
        RunAllSensors --> zest_v2Sensor: zest-v2

        state agent_hubSensor {
            [*] --> agent_hubGate: claimSensorRun(agent-hub)
            agent_hubGate --> agent_hubSkip: interval not elapsed
            agent_hubGate --> agent_hubDedup: interval elapsed
            agent_hubDedup --> agent_hubSkip: pending task exists
            agent_hubDedup --> agent_hubCreateTask: no dupe
            agent_hubCreateTask --> [*]: insertTask()
            agent_hubSkip --> [*]: return skip
        }

        state aibtc_dev_opsSensor {
            [*] --> aibtc_dev_opsGate: claimSensorRun(aibtc-dev-ops)
            aibtc_dev_opsGate --> aibtc_dev_opsSkip: interval not elapsed
            aibtc_dev_opsGate --> aibtc_dev_opsDedup: interval elapsed
            aibtc_dev_opsDedup --> aibtc_dev_opsSkip: pending task exists
            aibtc_dev_opsDedup --> aibtc_dev_opsCreateTask: no dupe
            aibtc_dev_opsCreateTask --> [*]: insertTask()
            aibtc_dev_opsSkip --> [*]: return skip
        }

        state aibtc_heartbeatSensor {
            [*] --> aibtc_heartbeatGate: claimSensorRun(aibtc-heartbeat)
            aibtc_heartbeatGate --> aibtc_heartbeatSkip: interval not elapsed
            aibtc_heartbeatGate --> aibtc_heartbeatDedup: interval elapsed
            aibtc_heartbeatDedup --> aibtc_heartbeatSkip: pending task exists
            aibtc_heartbeatDedup --> aibtc_heartbeatCreateTask: no dupe
            aibtc_heartbeatCreateTask --> [*]: insertTask()
            aibtc_heartbeatSkip --> [*]: return skip
        }

        state aibtc_inbox_syncSensor {
            [*] --> aibtc_inbox_syncGate: claimSensorRun(aibtc-inbox-sync)
            aibtc_inbox_syncGate --> aibtc_inbox_syncSkip: interval not elapsed
            aibtc_inbox_syncGate --> aibtc_inbox_syncDedup: interval elapsed
            aibtc_inbox_syncDedup --> aibtc_inbox_syncSkip: pending task exists
            aibtc_inbox_syncDedup --> aibtc_inbox_syncCreateTask: no dupe
            aibtc_inbox_syncCreateTask --> [*]: insertTask()
            aibtc_inbox_syncSkip --> [*]: return skip
        }

        state aibtc_news_deal_flowSensor {
            [*] --> aibtc_news_deal_flowGate: claimSensorRun(aibtc-news-deal-flow)
            aibtc_news_deal_flowGate --> aibtc_news_deal_flowSkip: interval not elapsed
            aibtc_news_deal_flowGate --> aibtc_news_deal_flowDedup: interval elapsed
            aibtc_news_deal_flowDedup --> aibtc_news_deal_flowSkip: pending task exists
            aibtc_news_deal_flowDedup --> aibtc_news_deal_flowCreateTask: no dupe
            aibtc_news_deal_flowCreateTask --> [*]: insertTask()
            aibtc_news_deal_flowSkip --> [*]: return skip
        }

        state aibtc_news_editorialSensor {
            [*] --> aibtc_news_editorialGate: claimSensorRun(aibtc-news-editorial)
            aibtc_news_editorialGate --> aibtc_news_editorialSkip: interval not elapsed
            aibtc_news_editorialGate --> aibtc_news_editorialDedup: interval elapsed
            aibtc_news_editorialDedup --> aibtc_news_editorialSkip: pending task exists
            aibtc_news_editorialDedup --> aibtc_news_editorialCreateTask: no dupe
            aibtc_news_editorialCreateTask --> [*]: insertTask()
            aibtc_news_editorialSkip --> [*]: return skip
        }

        state aibtc_repo_maintenanceSensor {
            [*] --> aibtc_repo_maintenanceGate: claimSensorRun(aibtc-repo-maintenance)
            aibtc_repo_maintenanceGate --> aibtc_repo_maintenanceSkip: interval not elapsed
            aibtc_repo_maintenanceGate --> aibtc_repo_maintenanceDedup: interval elapsed
            aibtc_repo_maintenanceDedup --> aibtc_repo_maintenanceSkip: pending task exists
            aibtc_repo_maintenanceDedup --> aibtc_repo_maintenanceCreateTask: no dupe
            aibtc_repo_maintenanceCreateTask --> [*]: insertTask()
            aibtc_repo_maintenanceSkip --> [*]: return skip
        }

        state aibtc_welcomeSensor {
            [*] --> aibtc_welcomeGate: claimSensorRun(aibtc-welcome)
            aibtc_welcomeGate --> aibtc_welcomeSkip: interval not elapsed
            aibtc_welcomeGate --> aibtc_welcomeDedup: interval elapsed
            aibtc_welcomeDedup --> aibtc_welcomeSkip: pending task exists
            aibtc_welcomeDedup --> aibtc_welcomeCreateTask: no dupe
            aibtc_welcomeCreateTask --> [*]: insertTask()
            aibtc_welcomeSkip --> [*]: return skip
        }

        state albSensor {
            [*] --> albGate: claimSensorRun(alb)
            albGate --> albSkip: interval not elapsed
            albGate --> albDedup: interval elapsed
            albDedup --> albSkip: pending task exists
            albDedup --> albCreateTask: no dupe
            albCreateTask --> [*]: insertTask()
            albSkip --> [*]: return skip
        }

        state arc_alive_checkSensor {
            [*] --> arc_alive_checkGate: claimSensorRun(arc-alive-check)
            arc_alive_checkGate --> arc_alive_checkSkip: interval not elapsed
            arc_alive_checkGate --> arc_alive_checkDedup: interval elapsed
            arc_alive_checkDedup --> arc_alive_checkSkip: pending task exists
            arc_alive_checkDedup --> arc_alive_checkCreateTask: no dupe
            arc_alive_checkCreateTask --> [*]: insertTask()
            arc_alive_checkSkip --> [*]: return skip
        }

        state arc_architecture_reviewSensor {
            [*] --> arc_architecture_reviewGate: claimSensorRun(arc-architecture-review)
            arc_architecture_reviewGate --> arc_architecture_reviewSkip: interval not elapsed
            arc_architecture_reviewGate --> arc_architecture_reviewDedup: interval elapsed
            arc_architecture_reviewDedup --> arc_architecture_reviewSkip: pending task exists
            arc_architecture_reviewDedup --> arc_architecture_reviewCreateTask: no dupe
            arc_architecture_reviewCreateTask --> [*]: insertTask()
            arc_architecture_reviewSkip --> [*]: return skip
        }

        state arc_blocked_reviewSensor {
            [*] --> arc_blocked_reviewGate: claimSensorRun(arc-blocked-review)
            arc_blocked_reviewGate --> arc_blocked_reviewSkip: interval not elapsed
            arc_blocked_reviewGate --> arc_blocked_reviewDedup: interval elapsed
            arc_blocked_reviewDedup --> arc_blocked_reviewSkip: pending task exists
            arc_blocked_reviewDedup --> arc_blocked_reviewCreateTask: no dupe
            arc_blocked_reviewCreateTask --> [*]: insertTask()
            arc_blocked_reviewSkip --> [*]: return skip
        }

        state arc_catalogSensor {
            [*] --> arc_catalogGate: claimSensorRun(arc-catalog)
            arc_catalogGate --> arc_catalogSkip: interval not elapsed
            arc_catalogGate --> arc_catalogDedup: interval elapsed
            arc_catalogDedup --> arc_catalogSkip: pending task exists
            arc_catalogDedup --> arc_catalogCreateTask: no dupe
            arc_catalogCreateTask --> [*]: insertTask()
            arc_catalogSkip --> [*]: return skip
        }

        state arc_ceo_reviewSensor {
            [*] --> arc_ceo_reviewGate: claimSensorRun(arc-ceo-review)
            arc_ceo_reviewGate --> arc_ceo_reviewSkip: interval not elapsed
            arc_ceo_reviewGate --> arc_ceo_reviewDedup: interval elapsed
            arc_ceo_reviewDedup --> arc_ceo_reviewSkip: pending task exists
            arc_ceo_reviewDedup --> arc_ceo_reviewCreateTask: no dupe
            arc_ceo_reviewCreateTask --> [*]: insertTask()
            arc_ceo_reviewSkip --> [*]: return skip
        }

        state arc_cost_reportingSensor {
            [*] --> arc_cost_reportingGate: claimSensorRun(arc-cost-reporting)
            arc_cost_reportingGate --> arc_cost_reportingSkip: interval not elapsed
            arc_cost_reportingGate --> arc_cost_reportingDedup: interval elapsed
            arc_cost_reportingDedup --> arc_cost_reportingSkip: pending task exists
            arc_cost_reportingDedup --> arc_cost_reportingCreateTask: no dupe
            arc_cost_reportingCreateTask --> [*]: insertTask()
            arc_cost_reportingSkip --> [*]: return skip
        }

        state arc_dispatch_evalSensor {
            [*] --> arc_dispatch_evalGate: claimSensorRun(arc-dispatch-eval)
            arc_dispatch_evalGate --> arc_dispatch_evalSkip: interval not elapsed
            arc_dispatch_evalGate --> arc_dispatch_evalDedup: interval elapsed
            arc_dispatch_evalDedup --> arc_dispatch_evalSkip: pending task exists
            arc_dispatch_evalDedup --> arc_dispatch_evalCreateTask: no dupe
            arc_dispatch_evalCreateTask --> [*]: insertTask()
            arc_dispatch_evalSkip --> [*]: return skip
        }

        state arc_email_syncSensor {
            [*] --> arc_email_syncGate: claimSensorRun(arc-email-sync)
            arc_email_syncGate --> arc_email_syncSkip: interval not elapsed
            arc_email_syncGate --> arc_email_syncDedup: interval elapsed
            arc_email_syncDedup --> arc_email_syncSkip: pending task exists
            arc_email_syncDedup --> arc_email_syncCreateTask: no dupe
            arc_email_syncCreateTask --> [*]: insertTask()
            arc_email_syncSkip --> [*]: return skip
        }

        state arc_failure_triageSensor {
            [*] --> arc_failure_triageGate: claimSensorRun(arc-failure-triage)
            arc_failure_triageGate --> arc_failure_triageSkip: interval not elapsed
            arc_failure_triageGate --> arc_failure_triageDedup: interval elapsed
            arc_failure_triageDedup --> arc_failure_triageSkip: pending task exists
            arc_failure_triageDedup --> arc_failure_triageCreateTask: no dupe
            arc_failure_triageCreateTask --> [*]: insertTask()
            arc_failure_triageSkip --> [*]: return skip
        }

        state arc_housekeepingSensor {
            [*] --> arc_housekeepingGate: claimSensorRun(arc-housekeeping)
            arc_housekeepingGate --> arc_housekeepingSkip: interval not elapsed
            arc_housekeepingGate --> arc_housekeepingDedup: interval elapsed
            arc_housekeepingDedup --> arc_housekeepingSkip: pending task exists
            arc_housekeepingDedup --> arc_housekeepingCreateTask: no dupe
            arc_housekeepingCreateTask --> [*]: insertTask()
            arc_housekeepingSkip --> [*]: return skip
        }

        state arc_introspectionSensor {
            [*] --> arc_introspectionGate: claimSensorRun(arc-introspection)
            arc_introspectionGate --> arc_introspectionSkip: interval not elapsed
            arc_introspectionGate --> arc_introspectionDedup: interval elapsed
            arc_introspectionDedup --> arc_introspectionSkip: pending task exists
            arc_introspectionDedup --> arc_introspectionCreateTask: no dupe
            arc_introspectionCreateTask --> [*]: insertTask()
            arc_introspectionSkip --> [*]: return skip
        }

        state arc_memorySensor {
            [*] --> arc_memoryGate: claimSensorRun(arc-memory)
            arc_memoryGate --> arc_memorySkip: interval not elapsed
            arc_memoryGate --> arc_memoryDedup: interval elapsed
            arc_memoryDedup --> arc_memorySkip: pending task exists
            arc_memoryDedup --> arc_memoryCreateTask: no dupe
            arc_memoryCreateTask --> [*]: insertTask()
            arc_memorySkip --> [*]: return skip
        }

        state arc_monitoring_serviceSensor {
            [*] --> arc_monitoring_serviceGate: claimSensorRun(arc-monitoring-service)
            arc_monitoring_serviceGate --> arc_monitoring_serviceSkip: interval not elapsed
            arc_monitoring_serviceGate --> arc_monitoring_serviceDedup: interval elapsed
            arc_monitoring_serviceDedup --> arc_monitoring_serviceSkip: pending task exists
            arc_monitoring_serviceDedup --> arc_monitoring_serviceCreateTask: no dupe
            arc_monitoring_serviceCreateTask --> [*]: insertTask()
            arc_monitoring_serviceSkip --> [*]: return skip
        }

        state arc_opensourceSensor {
            [*] --> arc_opensourceGate: claimSensorRun(arc-opensource)
            arc_opensourceGate --> arc_opensourceSkip: interval not elapsed
            arc_opensourceGate --> arc_opensourceDedup: interval elapsed
            arc_opensourceDedup --> arc_opensourceSkip: pending task exists
            arc_opensourceDedup --> arc_opensourceCreateTask: no dupe
            arc_opensourceCreateTask --> [*]: insertTask()
            arc_opensourceSkip --> [*]: return skip
        }

        state arc_ops_reviewSensor {
            [*] --> arc_ops_reviewGate: claimSensorRun(arc-ops-review)
            arc_ops_reviewGate --> arc_ops_reviewSkip: interval not elapsed
            arc_ops_reviewGate --> arc_ops_reviewDedup: interval elapsed
            arc_ops_reviewDedup --> arc_ops_reviewSkip: pending task exists
            arc_ops_reviewDedup --> arc_ops_reviewCreateTask: no dupe
            arc_ops_reviewCreateTask --> [*]: insertTask()
            arc_ops_reviewSkip --> [*]: return skip
        }

        state arc_paymentsSensor {
            [*] --> arc_paymentsGate: claimSensorRun(arc-payments)
            arc_paymentsGate --> arc_paymentsSkip: interval not elapsed
            arc_paymentsGate --> arc_paymentsDedup: interval elapsed
            arc_paymentsDedup --> arc_paymentsSkip: pending task exists
            arc_paymentsDedup --> arc_paymentsCreateTask: no dupe
            arc_paymentsCreateTask --> [*]: insertTask()
            arc_paymentsSkip --> [*]: return skip
        }

        state arc_report_emailSensor {
            [*] --> arc_report_emailGate: claimSensorRun(arc-report-email)
            arc_report_emailGate --> arc_report_emailSkip: interval not elapsed
            arc_report_emailGate --> arc_report_emailDedup: interval elapsed
            arc_report_emailDedup --> arc_report_emailSkip: pending task exists
            arc_report_emailDedup --> arc_report_emailCreateTask: no dupe
            arc_report_emailCreateTask --> [*]: insertTask()
            arc_report_emailSkip --> [*]: return skip
        }

        state arc_reportingSensor {
            [*] --> arc_reportingGate: claimSensorRun(arc-reporting)
            arc_reportingGate --> arc_reportingSkip: interval not elapsed
            arc_reportingGate --> arc_reportingDedup: interval elapsed
            arc_reportingDedup --> arc_reportingSkip: pending task exists
            arc_reportingDedup --> arc_reportingCreateTask: no dupe
            arc_reportingCreateTask --> [*]: insertTask()
            arc_reportingSkip --> [*]: return skip
        }

        state arc_reputationSensor {
            [*] --> arc_reputationGate: claimSensorRun(arc-reputation)
            arc_reputationGate --> arc_reputationSkip: interval not elapsed
            arc_reputationGate --> arc_reputationDedup: interval elapsed
            arc_reputationDedup --> arc_reputationSkip: pending task exists
            arc_reputationDedup --> arc_reputationCreateTask: no dupe
            arc_reputationCreateTask --> [*]: insertTask()
            arc_reputationSkip --> [*]: return skip
        }

        state arc_schedulerSensor {
            [*] --> arc_schedulerGate: claimSensorRun(arc-scheduler)
            arc_schedulerGate --> arc_schedulerSkip: interval not elapsed
            arc_schedulerGate --> arc_schedulerDedup: interval elapsed
            arc_schedulerDedup --> arc_schedulerSkip: pending task exists
            arc_schedulerDedup --> arc_schedulerCreateTask: no dupe
            arc_schedulerCreateTask --> [*]: insertTask()
            arc_schedulerSkip --> [*]: return skip
        }

        state arc_self_auditSensor {
            [*] --> arc_self_auditGate: claimSensorRun(arc-self-audit)
            arc_self_auditGate --> arc_self_auditSkip: interval not elapsed
            arc_self_auditGate --> arc_self_auditDedup: interval elapsed
            arc_self_auditDedup --> arc_self_auditSkip: pending task exists
            arc_self_auditDedup --> arc_self_auditCreateTask: no dupe
            arc_self_auditCreateTask --> [*]: insertTask()
            arc_self_auditSkip --> [*]: return skip
        }

        state arc_service_healthSensor {
            [*] --> arc_service_healthGate: claimSensorRun(arc-service-health)
            arc_service_healthGate --> arc_service_healthSkip: interval not elapsed
            arc_service_healthGate --> arc_service_healthDedup: interval elapsed
            arc_service_healthDedup --> arc_service_healthSkip: pending task exists
            arc_service_healthDedup --> arc_service_healthCreateTask: no dupe
            arc_service_healthCreateTask --> [*]: insertTask()
            arc_service_healthSkip --> [*]: return skip
        }

        state arc_skill_managerSensor {
            [*] --> arc_skill_managerGate: claimSensorRun(arc-skill-manager)
            arc_skill_managerGate --> arc_skill_managerSkip: interval not elapsed
            arc_skill_managerGate --> arc_skill_managerDedup: interval elapsed
            arc_skill_managerDedup --> arc_skill_managerSkip: pending task exists
            arc_skill_managerDedup --> arc_skill_managerCreateTask: no dupe
            arc_skill_managerCreateTask --> [*]: insertTask()
            arc_skill_managerSkip --> [*]: return skip
        }

        state arc_starter_publishSensor {
            [*] --> arc_starter_publishGate: claimSensorRun(arc-starter-publish)
            arc_starter_publishGate --> arc_starter_publishSkip: interval not elapsed
            arc_starter_publishGate --> arc_starter_publishDedup: interval elapsed
            arc_starter_publishDedup --> arc_starter_publishSkip: pending task exists
            arc_starter_publishDedup --> arc_starter_publishCreateTask: no dupe
            arc_starter_publishCreateTask --> [*]: insertTask()
            arc_starter_publishSkip --> [*]: return skip
        }

        state arc_strategy_reviewSensor {
            [*] --> arc_strategy_reviewGate: claimSensorRun(arc-strategy-review)
            arc_strategy_reviewGate --> arc_strategy_reviewSkip: interval not elapsed
            arc_strategy_reviewGate --> arc_strategy_reviewDedup: interval elapsed
            arc_strategy_reviewDedup --> arc_strategy_reviewSkip: pending task exists
            arc_strategy_reviewDedup --> arc_strategy_reviewCreateTask: no dupe
            arc_strategy_reviewCreateTask --> [*]: insertTask()
            arc_strategy_reviewSkip --> [*]: return skip
        }

        state arc_umbrelSensor {
            [*] --> arc_umbrelGate: claimSensorRun(arc-umbrel)
            arc_umbrelGate --> arc_umbrelSkip: interval not elapsed
            arc_umbrelGate --> arc_umbrelDedup: interval elapsed
            arc_umbrelDedup --> arc_umbrelSkip: pending task exists
            arc_umbrelDedup --> arc_umbrelCreateTask: no dupe
            arc_umbrelCreateTask --> [*]: insertTask()
            arc_umbrelSkip --> [*]: return skip
        }

        state arc_workflow_reviewSensor {
            [*] --> arc_workflow_reviewGate: claimSensorRun(arc-workflow-review)
            arc_workflow_reviewGate --> arc_workflow_reviewSkip: interval not elapsed
            arc_workflow_reviewGate --> arc_workflow_reviewDedup: interval elapsed
            arc_workflow_reviewDedup --> arc_workflow_reviewSkip: pending task exists
            arc_workflow_reviewDedup --> arc_workflow_reviewCreateTask: no dupe
            arc_workflow_reviewCreateTask --> [*]: insertTask()
            arc_workflow_reviewSkip --> [*]: return skip
        }

        state arc_workflowsSensor {
            [*] --> arc_workflowsGate: claimSensorRun(arc-workflows)
            arc_workflowsGate --> arc_workflowsSkip: interval not elapsed
            arc_workflowsGate --> arc_workflowsDedup: interval elapsed
            arc_workflowsDedup --> arc_workflowsSkip: pending task exists
            arc_workflowsDedup --> arc_workflowsCreateTask: no dupe
            arc_workflowsCreateTask --> [*]: insertTask()
            arc_workflowsSkip --> [*]: return skip
        }

        state arc0btc_pr_reviewSensor {
            [*] --> arc0btc_pr_reviewGate: claimSensorRun(arc0btc-pr-review)
            arc0btc_pr_reviewGate --> arc0btc_pr_reviewSkip: interval not elapsed
            arc0btc_pr_reviewGate --> arc0btc_pr_reviewDedup: interval elapsed
            arc0btc_pr_reviewDedup --> arc0btc_pr_reviewSkip: pending task exists
            arc0btc_pr_reviewDedup --> arc0btc_pr_reviewCreateTask: no dupe
            arc0btc_pr_reviewCreateTask --> [*]: insertTask()
            arc0btc_pr_reviewSkip --> [*]: return skip
        }

        state arc0btc_security_auditSensor {
            [*] --> arc0btc_security_auditGate: claimSensorRun(arc0btc-security-audit)
            arc0btc_security_auditGate --> arc0btc_security_auditSkip: interval not elapsed
            arc0btc_security_auditGate --> arc0btc_security_auditDedup: interval elapsed
            arc0btc_security_auditDedup --> arc0btc_security_auditSkip: pending task exists
            arc0btc_security_auditDedup --> arc0btc_security_auditCreateTask: no dupe
            arc0btc_security_auditCreateTask --> [*]: insertTask()
            arc0btc_security_auditSkip --> [*]: return skip
        }

        state arc0btc_site_healthSensor {
            [*] --> arc0btc_site_healthGate: claimSensorRun(arc0btc-site-health)
            arc0btc_site_healthGate --> arc0btc_site_healthSkip: interval not elapsed
            arc0btc_site_healthGate --> arc0btc_site_healthDedup: interval elapsed
            arc0btc_site_healthDedup --> arc0btc_site_healthSkip: pending task exists
            arc0btc_site_healthDedup --> arc0btc_site_healthCreateTask: no dupe
            arc0btc_site_healthCreateTask --> [*]: insertTask()
            arc0btc_site_healthSkip --> [*]: return skip
        }

        state arxiv_researchSensor {
            [*] --> arxiv_researchGate: claimSensorRun(arxiv-research)
            arxiv_researchGate --> arxiv_researchSkip: interval not elapsed
            arxiv_researchGate --> arxiv_researchDedup: interval elapsed
            arxiv_researchDedup --> arxiv_researchSkip: pending task exists
            arxiv_researchDedup --> arxiv_researchCreateTask: no dupe
            arxiv_researchCreateTask --> [*]: insertTask()
            arxiv_researchSkip --> [*]: return skip
        }

        state auto_queueSensor {
            [*] --> auto_queueGate: claimSensorRun(auto-queue)
            auto_queueGate --> auto_queueSkip: interval not elapsed
            auto_queueGate --> auto_queueDedup: interval elapsed
            auto_queueDedup --> auto_queueSkip: pending task exists
            auto_queueDedup --> auto_queueCreateTask: no dupe
            auto_queueCreateTask --> [*]: insertTask()
            auto_queueSkip --> [*]: return skip
        }

        state bitcoin_quorumclawSensor {
            [*] --> bitcoin_quorumclawGate: claimSensorRun(bitcoin-quorumclaw)
            bitcoin_quorumclawGate --> bitcoin_quorumclawSkip: interval not elapsed
            bitcoin_quorumclawGate --> bitcoin_quorumclawDedup: interval elapsed
            bitcoin_quorumclawDedup --> bitcoin_quorumclawSkip: pending task exists
            bitcoin_quorumclawDedup --> bitcoin_quorumclawCreateTask: no dupe
            bitcoin_quorumclawCreateTask --> [*]: insertTask()
            bitcoin_quorumclawSkip --> [*]: return skip
        }

        state bitflowSensor {
            [*] --> bitflowGate: claimSensorRun(bitflow)
            bitflowGate --> bitflowSkip: interval not elapsed
            bitflowGate --> bitflowDedup: interval elapsed
            bitflowDedup --> bitflowSkip: pending task exists
            bitflowDedup --> bitflowCreateTask: no dupe
            bitflowCreateTask --> [*]: insertTask()
            bitflowSkip --> [*]: return skip
        }

        state blog_deploySensor {
            [*] --> blog_deployGate: claimSensorRun(blog-deploy)
            blog_deployGate --> blog_deploySkip: interval not elapsed
            blog_deployGate --> blog_deployDedup: interval elapsed
            blog_deployDedup --> blog_deploySkip: pending task exists
            blog_deployDedup --> blog_deployCreateTask: no dupe
            blog_deployCreateTask --> [*]: insertTask()
            blog_deploySkip --> [*]: return skip
        }

        state blog_publishingSensor {
            [*] --> blog_publishingGate: claimSensorRun(blog-publishing)
            blog_publishingGate --> blog_publishingSkip: interval not elapsed
            blog_publishingGate --> blog_publishingDedup: interval elapsed
            blog_publishingDedup --> blog_publishingSkip: pending task exists
            blog_publishingDedup --> blog_publishingCreateTask: no dupe
            blog_publishingCreateTask --> [*]: insertTask()
            blog_publishingSkip --> [*]: return skip
        }

        state compliance_reviewSensor {
            [*] --> compliance_reviewGate: claimSensorRun(compliance-review)
            compliance_reviewGate --> compliance_reviewSkip: interval not elapsed
            compliance_reviewGate --> compliance_reviewDedup: interval elapsed
            compliance_reviewDedup --> compliance_reviewSkip: pending task exists
            compliance_reviewDedup --> compliance_reviewCreateTask: no dupe
            compliance_reviewCreateTask --> [*]: insertTask()
            compliance_reviewSkip --> [*]: return skip
        }

        state contactsSensor {
            [*] --> contactsGate: claimSensorRun(contacts)
            contactsGate --> contactsSkip: interval not elapsed
            contactsGate --> contactsDedup: interval elapsed
            contactsDedup --> contactsSkip: pending task exists
            contactsDedup --> contactsCreateTask: no dupe
            contactsCreateTask --> [*]: insertTask()
            contactsSkip --> [*]: return skip
        }

        state context_reviewSensor {
            [*] --> context_reviewGate: claimSensorRun(context-review)
            context_reviewGate --> context_reviewSkip: interval not elapsed
            context_reviewGate --> context_reviewDedup: interval elapsed
            context_reviewDedup --> context_reviewSkip: pending task exists
            context_reviewDedup --> context_reviewCreateTask: no dupe
            context_reviewCreateTask --> [*]: insertTask()
            context_reviewSkip --> [*]: return skip
        }

        state defi_bitflowSensor {
            [*] --> defi_bitflowGate: claimSensorRun(defi-bitflow)
            defi_bitflowGate --> defi_bitflowSkip: interval not elapsed
            defi_bitflowGate --> defi_bitflowDedup: interval elapsed
            defi_bitflowDedup --> defi_bitflowSkip: pending task exists
            defi_bitflowDedup --> defi_bitflowCreateTask: no dupe
            defi_bitflowCreateTask --> [*]: insertTask()
            defi_bitflowSkip --> [*]: return skip
        }

        state defi_compoundingSensor {
            [*] --> defi_compoundingGate: claimSensorRun(defi-compounding)
            defi_compoundingGate --> defi_compoundingSkip: interval not elapsed
            defi_compoundingGate --> defi_compoundingDedup: interval elapsed
            defi_compoundingDedup --> defi_compoundingSkip: pending task exists
            defi_compoundingDedup --> defi_compoundingCreateTask: no dupe
            defi_compoundingCreateTask --> [*]: insertTask()
            defi_compoundingSkip --> [*]: return skip
        }

        state defi_stacks_marketSensor {
            [*] --> defi_stacks_marketGate: claimSensorRun(defi-stacks-market)
            defi_stacks_marketGate --> defi_stacks_marketSkip: interval not elapsed
            defi_stacks_marketGate --> defi_stacks_marketDedup: interval elapsed
            defi_stacks_marketDedup --> defi_stacks_marketSkip: pending task exists
            defi_stacks_marketDedup --> defi_stacks_marketCreateTask: no dupe
            defi_stacks_marketCreateTask --> [*]: insertTask()
            defi_stacks_marketSkip --> [*]: return skip
        }

        state defi_zestSensor {
            [*] --> defi_zestGate: claimSensorRun(defi-zest)
            defi_zestGate --> defi_zestSkip: interval not elapsed
            defi_zestGate --> defi_zestDedup: interval elapsed
            defi_zestDedup --> defi_zestSkip: pending task exists
            defi_zestDedup --> defi_zestCreateTask: no dupe
            defi_zestCreateTask --> [*]: insertTask()
            defi_zestSkip --> [*]: return skip
        }

        state erc8004_indexerSensor {
            [*] --> erc8004_indexerGate: claimSensorRun(erc8004-indexer)
            erc8004_indexerGate --> erc8004_indexerSkip: interval not elapsed
            erc8004_indexerGate --> erc8004_indexerDedup: interval elapsed
            erc8004_indexerDedup --> erc8004_indexerSkip: pending task exists
            erc8004_indexerDedup --> erc8004_indexerCreateTask: no dupe
            erc8004_indexerCreateTask --> [*]: insertTask()
            erc8004_indexerSkip --> [*]: return skip
        }

        state erc8004_reputationSensor {
            [*] --> erc8004_reputationGate: claimSensorRun(erc8004-reputation)
            erc8004_reputationGate --> erc8004_reputationSkip: interval not elapsed
            erc8004_reputationGate --> erc8004_reputationDedup: interval elapsed
            erc8004_reputationDedup --> erc8004_reputationSkip: pending task exists
            erc8004_reputationDedup --> erc8004_reputationCreateTask: no dupe
            erc8004_reputationCreateTask --> [*]: insertTask()
            erc8004_reputationSkip --> [*]: return skip
        }

        state fleet_commsSensor {
            [*] --> fleet_commsGate: claimSensorRun(fleet-comms)
            fleet_commsGate --> fleet_commsSkip: interval not elapsed
            fleet_commsGate --> fleet_commsDedup: interval elapsed
            fleet_commsDedup --> fleet_commsSkip: pending task exists
            fleet_commsDedup --> fleet_commsCreateTask: no dupe
            fleet_commsCreateTask --> [*]: insertTask()
            fleet_commsSkip --> [*]: return skip
        }

        state fleet_dashboardSensor {
            [*] --> fleet_dashboardGate: claimSensorRun(fleet-dashboard)
            fleet_dashboardGate --> fleet_dashboardSkip: interval not elapsed
            fleet_dashboardGate --> fleet_dashboardDedup: interval elapsed
            fleet_dashboardDedup --> fleet_dashboardSkip: pending task exists
            fleet_dashboardDedup --> fleet_dashboardCreateTask: no dupe
            fleet_dashboardCreateTask --> [*]: insertTask()
            fleet_dashboardSkip --> [*]: return skip
        }

        state fleet_escalationSensor {
            [*] --> fleet_escalationGate: claimSensorRun(fleet-escalation)
            fleet_escalationGate --> fleet_escalationSkip: interval not elapsed
            fleet_escalationGate --> fleet_escalationDedup: interval elapsed
            fleet_escalationDedup --> fleet_escalationSkip: pending task exists
            fleet_escalationDedup --> fleet_escalationCreateTask: no dupe
            fleet_escalationCreateTask --> [*]: insertTask()
            fleet_escalationSkip --> [*]: return skip
        }

        state fleet_healthSensor {
            [*] --> fleet_healthGate: claimSensorRun(fleet-health)
            fleet_healthGate --> fleet_healthSkip: interval not elapsed
            fleet_healthGate --> fleet_healthDedup: interval elapsed
            fleet_healthDedup --> fleet_healthSkip: pending task exists
            fleet_healthDedup --> fleet_healthCreateTask: no dupe
            fleet_healthCreateTask --> [*]: insertTask()
            fleet_healthSkip --> [*]: return skip
        }

        state fleet_log_pullSensor {
            [*] --> fleet_log_pullGate: claimSensorRun(fleet-log-pull)
            fleet_log_pullGate --> fleet_log_pullSkip: interval not elapsed
            fleet_log_pullGate --> fleet_log_pullDedup: interval elapsed
            fleet_log_pullDedup --> fleet_log_pullSkip: pending task exists
            fleet_log_pullDedup --> fleet_log_pullCreateTask: no dupe
            fleet_log_pullCreateTask --> [*]: insertTask()
            fleet_log_pullSkip --> [*]: return skip
        }

        state fleet_memorySensor {
            [*] --> fleet_memoryGate: claimSensorRun(fleet-memory)
            fleet_memoryGate --> fleet_memorySkip: interval not elapsed
            fleet_memoryGate --> fleet_memoryDedup: interval elapsed
            fleet_memoryDedup --> fleet_memorySkip: pending task exists
            fleet_memoryDedup --> fleet_memoryCreateTask: no dupe
            fleet_memoryCreateTask --> [*]: insertTask()
            fleet_memorySkip --> [*]: return skip
        }

        state fleet_rebalanceSensor {
            [*] --> fleet_rebalanceGate: claimSensorRun(fleet-rebalance)
            fleet_rebalanceGate --> fleet_rebalanceSkip: interval not elapsed
            fleet_rebalanceGate --> fleet_rebalanceDedup: interval elapsed
            fleet_rebalanceDedup --> fleet_rebalanceSkip: pending task exists
            fleet_rebalanceDedup --> fleet_rebalanceCreateTask: no dupe
            fleet_rebalanceCreateTask --> [*]: insertTask()
            fleet_rebalanceSkip --> [*]: return skip
        }

        state fleet_routerSensor {
            [*] --> fleet_routerGate: claimSensorRun(fleet-router)
            fleet_routerGate --> fleet_routerSkip: interval not elapsed
            fleet_routerGate --> fleet_routerDedup: interval elapsed
            fleet_routerDedup --> fleet_routerSkip: pending task exists
            fleet_routerDedup --> fleet_routerCreateTask: no dupe
            fleet_routerCreateTask --> [*]: insertTask()
            fleet_routerSkip --> [*]: return skip
        }

        state fleet_self_syncSensor {
            [*] --> fleet_self_syncGate: claimSensorRun(fleet-self-sync)
            fleet_self_syncGate --> fleet_self_syncSkip: interval not elapsed
            fleet_self_syncGate --> fleet_self_syncDedup: interval elapsed
            fleet_self_syncDedup --> fleet_self_syncSkip: pending task exists
            fleet_self_syncDedup --> fleet_self_syncCreateTask: no dupe
            fleet_self_syncCreateTask --> [*]: insertTask()
            fleet_self_syncSkip --> [*]: return skip
        }

        state fleet_syncSensor {
            [*] --> fleet_syncGate: claimSensorRun(fleet-sync)
            fleet_syncGate --> fleet_syncSkip: interval not elapsed
            fleet_syncGate --> fleet_syncDedup: interval elapsed
            fleet_syncDedup --> fleet_syncSkip: pending task exists
            fleet_syncDedup --> fleet_syncCreateTask: no dupe
            fleet_syncCreateTask --> [*]: insertTask()
            fleet_syncSkip --> [*]: return skip
        }

        state github_ci_statusSensor {
            [*] --> github_ci_statusGate: claimSensorRun(github-ci-status)
            github_ci_statusGate --> github_ci_statusSkip: interval not elapsed
            github_ci_statusGate --> github_ci_statusDedup: interval elapsed
            github_ci_statusDedup --> github_ci_statusSkip: pending task exists
            github_ci_statusDedup --> github_ci_statusCreateTask: no dupe
            github_ci_statusCreateTask --> [*]: insertTask()
            github_ci_statusSkip --> [*]: return skip
        }

        state github_interceptorSensor {
            [*] --> github_interceptorGate: claimSensorRun(github-interceptor)
            github_interceptorGate --> github_interceptorSkip: interval not elapsed
            github_interceptorGate --> github_interceptorDedup: interval elapsed
            github_interceptorDedup --> github_interceptorSkip: pending task exists
            github_interceptorDedup --> github_interceptorCreateTask: no dupe
            github_interceptorCreateTask --> [*]: insertTask()
            github_interceptorSkip --> [*]: return skip
        }

        state github_issue_monitorSensor {
            [*] --> github_issue_monitorGate: claimSensorRun(github-issue-monitor)
            github_issue_monitorGate --> github_issue_monitorSkip: interval not elapsed
            github_issue_monitorGate --> github_issue_monitorDedup: interval elapsed
            github_issue_monitorDedup --> github_issue_monitorSkip: pending task exists
            github_issue_monitorDedup --> github_issue_monitorCreateTask: no dupe
            github_issue_monitorCreateTask --> [*]: insertTask()
            github_issue_monitorSkip --> [*]: return skip
        }

        state github_issuesSensor {
            [*] --> github_issuesGate: claimSensorRun(github-issues)
            github_issuesGate --> github_issuesSkip: interval not elapsed
            github_issuesGate --> github_issuesDedup: interval elapsed
            github_issuesDedup --> github_issuesSkip: pending task exists
            github_issuesDedup --> github_issuesCreateTask: no dupe
            github_issuesCreateTask --> [*]: insertTask()
            github_issuesSkip --> [*]: return skip
        }

        state github_mentionsSensor {
            [*] --> github_mentionsGate: claimSensorRun(github-mentions)
            github_mentionsGate --> github_mentionsSkip: interval not elapsed
            github_mentionsGate --> github_mentionsDedup: interval elapsed
            github_mentionsDedup --> github_mentionsSkip: pending task exists
            github_mentionsDedup --> github_mentionsCreateTask: no dupe
            github_mentionsCreateTask --> [*]: insertTask()
            github_mentionsSkip --> [*]: return skip
        }

        state github_release_watcherSensor {
            [*] --> github_release_watcherGate: claimSensorRun(github-release-watcher)
            github_release_watcherGate --> github_release_watcherSkip: interval not elapsed
            github_release_watcherGate --> github_release_watcherDedup: interval elapsed
            github_release_watcherDedup --> github_release_watcherSkip: pending task exists
            github_release_watcherDedup --> github_release_watcherCreateTask: no dupe
            github_release_watcherCreateTask --> [*]: insertTask()
            github_release_watcherSkip --> [*]: return skip
        }

        state github_security_alertsSensor {
            [*] --> github_security_alertsGate: claimSensorRun(github-security-alerts)
            github_security_alertsGate --> github_security_alertsSkip: interval not elapsed
            github_security_alertsGate --> github_security_alertsDedup: interval elapsed
            github_security_alertsDedup --> github_security_alertsSkip: pending task exists
            github_security_alertsDedup --> github_security_alertsCreateTask: no dupe
            github_security_alertsCreateTask --> [*]: insertTask()
            github_security_alertsSkip --> [*]: return skip
        }

        state github_worker_logsSensor {
            [*] --> github_worker_logsGate: claimSensorRun(github-worker-logs)
            github_worker_logsGate --> github_worker_logsSkip: interval not elapsed
            github_worker_logsGate --> github_worker_logsDedup: interval elapsed
            github_worker_logsDedup --> github_worker_logsSkip: pending task exists
            github_worker_logsDedup --> github_worker_logsCreateTask: no dupe
            github_worker_logsCreateTask --> [*]: insertTask()
            github_worker_logsSkip --> [*]: return skip
        }

        state identity_guardSensor {
            [*] --> identity_guardGate: claimSensorRun(identity-guard)
            identity_guardGate --> identity_guardSkip: interval not elapsed
            identity_guardGate --> identity_guardDedup: interval elapsed
            identity_guardDedup --> identity_guardSkip: pending task exists
            identity_guardDedup --> identity_guardCreateTask: no dupe
            identity_guardCreateTask --> [*]: insertTask()
            identity_guardSkip --> [*]: return skip
        }

        state mempool_watchSensor {
            [*] --> mempool_watchGate: claimSensorRun(mempool-watch)
            mempool_watchGate --> mempool_watchSkip: interval not elapsed
            mempool_watchGate --> mempool_watchDedup: interval elapsed
            mempool_watchDedup --> mempool_watchSkip: pending task exists
            mempool_watchDedup --> mempool_watchCreateTask: no dupe
            mempool_watchCreateTask --> [*]: insertTask()
            mempool_watchSkip --> [*]: return skip
        }

        state site_consistencySensor {
            [*] --> site_consistencyGate: claimSensorRun(site-consistency)
            site_consistencyGate --> site_consistencySkip: interval not elapsed
            site_consistencyGate --> site_consistencyDedup: interval elapsed
            site_consistencyDedup --> site_consistencySkip: pending task exists
            site_consistencyDedup --> site_consistencyCreateTask: no dupe
            site_consistencyCreateTask --> [*]: insertTask()
            site_consistencySkip --> [*]: return skip
        }

        state skill_effectivenessSensor {
            [*] --> skill_effectivenessGate: claimSensorRun(skill-effectiveness)
            skill_effectivenessGate --> skill_effectivenessSkip: interval not elapsed
            skill_effectivenessGate --> skill_effectivenessDedup: interval elapsed
            skill_effectivenessDedup --> skill_effectivenessSkip: pending task exists
            skill_effectivenessDedup --> skill_effectivenessCreateTask: no dupe
            skill_effectivenessCreateTask --> [*]: insertTask()
            skill_effectivenessSkip --> [*]: return skip
        }

        state social_agent_engagementSensor {
            [*] --> social_agent_engagementGate: claimSensorRun(social-agent-engagement)
            social_agent_engagementGate --> social_agent_engagementSkip: interval not elapsed
            social_agent_engagementGate --> social_agent_engagementDedup: interval elapsed
            social_agent_engagementDedup --> social_agent_engagementSkip: pending task exists
            social_agent_engagementDedup --> social_agent_engagementCreateTask: no dupe
            social_agent_engagementCreateTask --> [*]: insertTask()
            social_agent_engagementSkip --> [*]: return skip
        }

        state social_x_ecosystemSensor {
            [*] --> social_x_ecosystemGate: claimSensorRun(social-x-ecosystem)
            social_x_ecosystemGate --> social_x_ecosystemSkip: interval not elapsed
            social_x_ecosystemGate --> social_x_ecosystemDedup: interval elapsed
            social_x_ecosystemDedup --> social_x_ecosystemSkip: pending task exists
            social_x_ecosystemDedup --> social_x_ecosystemCreateTask: no dupe
            social_x_ecosystemCreateTask --> [*]: insertTask()
            social_x_ecosystemSkip --> [*]: return skip
        }

        state social_x_postingSensor {
            [*] --> social_x_postingGate: claimSensorRun(social-x-posting)
            social_x_postingGate --> social_x_postingSkip: interval not elapsed
            social_x_postingGate --> social_x_postingDedup: interval elapsed
            social_x_postingDedup --> social_x_postingSkip: pending task exists
            social_x_postingDedup --> social_x_postingCreateTask: no dupe
            social_x_postingCreateTask --> [*]: insertTask()
            social_x_postingSkip --> [*]: return skip
        }

        state stacks_stackspotSensor {
            [*] --> stacks_stackspotGate: claimSensorRun(stacks-stackspot)
            stacks_stackspotGate --> stacks_stackspotSkip: interval not elapsed
            stacks_stackspotGate --> stacks_stackspotDedup: interval elapsed
            stacks_stackspotDedup --> stacks_stackspotSkip: pending task exists
            stacks_stackspotDedup --> stacks_stackspotCreateTask: no dupe
            stacks_stackspotCreateTask --> [*]: insertTask()
            stacks_stackspotSkip --> [*]: return skip
        }

        state systems_monitorSensor {
            [*] --> systems_monitorGate: claimSensorRun(systems-monitor)
            systems_monitorGate --> systems_monitorSkip: interval not elapsed
            systems_monitorGate --> systems_monitorDedup: interval elapsed
            systems_monitorDedup --> systems_monitorSkip: pending task exists
            systems_monitorDedup --> systems_monitorCreateTask: no dupe
            systems_monitorCreateTask --> [*]: insertTask()
            systems_monitorSkip --> [*]: return skip
        }

        state worker_deploySensor {
            [*] --> worker_deployGate: claimSensorRun(worker-deploy)
            worker_deployGate --> worker_deploySkip: interval not elapsed
            worker_deployGate --> worker_deployDedup: interval elapsed
            worker_deployDedup --> worker_deploySkip: pending task exists
            worker_deployDedup --> worker_deployCreateTask: no dupe
            worker_deployCreateTask --> [*]: insertTask()
            worker_deploySkip --> [*]: return skip
        }

        state worker_logs_monitorSensor {
            [*] --> worker_logs_monitorGate: claimSensorRun(worker-logs-monitor)
            worker_logs_monitorGate --> worker_logs_monitorSkip: interval not elapsed
            worker_logs_monitorGate --> worker_logs_monitorDedup: interval elapsed
            worker_logs_monitorDedup --> worker_logs_monitorSkip: pending task exists
            worker_logs_monitorDedup --> worker_logs_monitorCreateTask: no dupe
            worker_logs_monitorCreateTask --> [*]: insertTask()
            worker_logs_monitorSkip --> [*]: return skip
        }

        state zest_v2Sensor {
            [*] --> zest_v2Gate: claimSensorRun(zest-v2)
            zest_v2Gate --> zest_v2Skip: interval not elapsed
            zest_v2Gate --> zest_v2Dedup: interval elapsed
            zest_v2Dedup --> zest_v2Skip: pending task exists
            zest_v2Dedup --> zest_v2CreateTask: no dupe
            zest_v2CreateTask --> [*]: insertTask()
            zest_v2Skip --> [*]: return skip
        }

    }

    state DispatchService {
        [*] --> CheckLock: db/dispatch-lock.json
        CheckLock --> Exit: lock held by live PID
        CheckLock --> CrashRecovery: lock held by dead PID
        CheckLock --> PickTask: no lock
        CrashRecovery --> PickTask: mark stale active tasks failed
        PickTask --> Idle: no pending tasks
        PickTask --> BuildPrompt: highest priority task

        state BuildPrompt {
            [*] --> LoadCore: SOUL.md + CLAUDE.md + MEMORY.md
            LoadCore --> LoadSkills: task.skills JSON array
            LoadSkills --> LoadSkillMd: for each skill name
            LoadSkillMd --> AssemblePrompt: SKILL.md content
            note right of LoadSkillMd: Only SKILL.md loaded\nAGENT.md stays for subagents
        }

        BuildPrompt --> WriteLock: markTaskActive()
        WriteLock --> SpawnClaude: claude --print --verbose
        SpawnClaude --> ParseResult: stream-json output
        ParseResult --> CheckSelfClose: task still active?
        CheckSelfClose --> RecordCost: LLM called arc tasks close
        CheckSelfClose --> FallbackClose: fallback markTaskCompleted
        FallbackClose --> RecordCost
        RecordCost --> ClearLock
        ClearLock --> AutoCommit: git add memory/ skills/ src/ templates/
        AutoCommit --> [*]
    }

    state CLI {
        [*] --> ArcCommand: arc <subcommand>
        ArcCommand --> TasksCRUD: tasks add/close/list
        ArcCommand --> SkillsRun: skills run --name X
        ArcCommand --> ManualDispatch: run
        ArcCommand --> StatusView: status
    }

    note right of CLI
        Skills with CLI:
        - agent-hub
        - aibtc-dev-ops
        - aibtc-news-classifieds
        - aibtc-news-deal-flow
        - aibtc-news-editorial
        - aibtc-repo-maintenance
        - alb
        - arc-architecture-review
        - arc-brand-voice
        - arc-catalog
        - arc-content-quality
        - arc-credentials
        - arc-dispatch-evals
        - arc-email-sync
        - arc-failure-triage
        - arc-housekeeping
        - arc-link-research
        - arc-mcp
        - arc-mcp-server
        - arc-memory
        - arc-monitoring-service
        - arc-observatory
        - arc-opensource
        - arc-payments
        - arc-performance-analytics
        - arc-remote-setup
        - arc-reputation
        - arc-skill-manager
        - arc-starter-publish
        - arc-umbrel
        - arc-web-dashboard
        - arc-workflows
        - arc-worktrees
        - arc0btc-ask-service
        - arc0btc-monetization
        - arc0btc-site-health
        - arxiv-research
        - auto-queue
        - bitcoin-quorumclaw
        - bitcoin-taproot-multisig
        - bitcoin-wallet
        - bitflow
        - blog-deploy
        - blog-publishing
        - code-audit
        - contacts
        - dao-zero-authority
        - defi-bitflow
        - defi-stacks-market
        - defi-zest
        - erc8004-identity
        - erc8004-indexer
        - erc8004-reputation
        - erc8004-trust
        - erc8004-validation
        - fleet-escalation
        - fleet-handoff
        - fleet-health
        - fleet-log-pull
        - fleet-memory
        - fleet-push
        - fleet-rebalance
        - fleet-router
        - fleet-self-sync
        - fleet-sync
        - github-issues
        - github-worker-logs
        - jingswap
        - maximumsats
        - maximumsats-wot
        - quest-create
        - site-consistency
        - skill-effectiveness
        - social-agent-engagement
        - social-x-posting
        - stacks-stackspot
        - styx
        - systems-monitor
        - worker-deploy
        - worker-logs-monitor
        - zest-v2
    end note
```

## Decision Points

| # | Point | Context Available | Gate |
|---|-------|-------------------|------|
| 1 | Sensor fires | Hook state (interval check) | `claimSensorRun()` |
| 2 | Sensor creates task | External data + dedup check | `pendingTaskExistsForSource()` |
| 3 | Dispatch lock check | Lock file (PID + task_id) | `isPidAlive()` |
| 4 | Task selection | All pending tasks sorted | Priority ASC, ID ASC |
| 5 | Skill loading | `task.skills` JSON array | SKILL.md existence |
| 6 | Prompt assembly | SOUL + CLAUDE + MEMORY + skills | Token budget ~40-50k |
| 7 | LLM execution | Full prompt + CLI access | `arc` commands only |
| 8 | Result handling | Task status check post-run | Self-close vs fallback |
| 9 | Auto-commit | Staged dirs: memory/ skills/ src/ templates/ | `git diff --cached` |

## Skills Inventory

| Skill | Sensor | CLI | Agent | Description |
|-------|--------|-----|-------|-------------|
| agent-hub | yes | yes | - | Fleet-internal agent registry, capability index, and task routing hub |
| aibtc-dev-ops | yes | yes | yes | Monitor service health via worker-logs and enforce production-grade standards across all aibtcdev repos |
| aibtc-heartbeat | yes | - | - | Signed AIBTC platform check-in every 5 minutes via BIP-137 Bitcoin message signing |
| aibtc-inbox-sync | yes | - | yes | Poll AIBTC platform inbox, sync messages locally, queue tasks for unread messages |
| aibtc-news-classifieds | - | yes | yes | Classified ads and extended API coverage for aibtc.news — list, post, and manage classifieds; read briefs; correct signals; update beats; fetch streaks and editorial resources |
| aibtc-news-deal-flow | yes | yes | yes | Editorial voice for Deal Flow beat on aibtc.news — Real-time market signals, sats, Ordinals, bounties |
| aibtc-news-editorial | yes | yes | yes | File intelligence signals, claim editorial beats, track correspondent activity on aibtc.news |
| aibtc-repo-maintenance | yes | yes | yes | Triage, review, test, and support aibtcdev repos we depend on |
| aibtc-welcome | yes | - | - | Detect new AIBTC agents and send welcome messages via x402 + STX micro-transfer |
| alb | yes | yes | - | Agents Love Bitcoin (agentslovebitcoin.com) — BTC-authenticated inbox for trustless_indra |
| arc-alive-check | yes | - | - | Periodic system-alive task creator — 6-hour canary confirming dispatch loop is healthy |
| arc-architecture-review | yes | yes | yes | Continuous architecture review, state machine diagrams, and simplification via SpaceX 5-step process |
| arc-blocked-review | yes | - | - | Sensor that periodically reviews blocked tasks to check if they can be unblocked |
| arc-brand-voice | - | yes | yes | Brand identity consultant — voice rules, visual design system, content review |
| arc-catalog | yes | yes | - | Generate and publish skills/sensors catalog to arc0me-site |
| arc-ceo-review | yes | - | yes | CEO reviews the latest watch report and actively manages the task queue |
| arc-ceo-strategy | - | - | yes | Strategic operating manual — treat yourself as CEO of a one-entity company |
| arc-content-quality | - | yes | - | Quality gate that checks content for AI writing patterns before publishing blog posts, X posts, and AIBTC signals |
| arc-cost-reporting | yes | - | - | Daily cost and token usage report — tracks dual costs (Claude Code vs API estimates) |
| arc-credentials | - | yes | yes | Encrypted credential store for API keys, tokens, and secrets used by other skills |
| arc-dispatch-eval | yes | - | - | Post-dispatch evaluation sensor — scores task outcomes and creates improvement tasks |
| arc-dispatch-evals | - | yes | yes | Dispatch quality evaluation — error analysis, LLM judges, calibration |
| arc-email-sync | yes | yes | yes | Sync email from arc-email-worker, detect unread messages, read and send email |
| arc-failure-triage | yes | yes | yes | Detect recurring failure patterns, escalate to investigation instead of retry |
| arc-housekeeping | yes | yes | yes | Periodic repo hygiene checks — uncommitted changes, stale locks, WAL size, memory bloat, file archival |
| arc-inbox | - | - | - | On-chain message inbox for Arc — Clarity contract on Stacks for public message submission and Arc-only replies. |
| arc-introspection | yes | - | - | Daily introspection — synthesizes 24h of dispatch cycles into qualitative self-assessment |
| arc-link-research | - | yes | yes | Process batches of links into mission-relevant research reports — evaluates Bitcoin/AIBTC/Stacks relevance |
| arc-mcp | - | yes | - | Local MCP HTTP server exposing task queue and skill tree |
| arc-mcp-server | - | yes | yes | MCP server exposing Arc's task queue, skills, and memory to external Claude instances |
| arc-memory | yes | yes | - | Pattern libraries and decision frameworks — loads memory/patterns.md + memory/frameworks.md to change how problems are approached, not just store notes |
| arc-monitoring-service | yes | yes | - | Paid endpoint monitoring service — checks uptime, response time, and alerts on failures |
| arc-observatory | - | yes | - | Consolidated web UI for multi-agent fleet observability |
| arc-opensource | yes | yes | - | - |
| arc-ops-review | yes | - | - | Tracks task creation vs completion rate, backlog trend, fleet utilization, and cost-per-useful-output |
| arc-payments | yes | yes | - | Watch Stacks blockchain for STX and sBTC payments to Arc's address and create service tasks from arc: memo codes |
| arc-performance-analytics | - | yes | - | Cost and token analytics by model tier, skill, and time period |
| arc-remote-setup | - | yes | - | SSH-based VM provisioning for agent fleet deployment |
| arc-report-email | yes | - | - | Email watch reports when new ones are generated — sensor-only, fires after CEO review completes |
| arc-reporting | yes | - | yes | Generate watch reports (HTML, 6-hour) and overnight briefs (markdown, daily 6am PST) |
| arc-reputation | yes | yes | - | Signed peer reviews with BIP-322 signatures, local SQLite storage, and give-feedback CLI |
| arc-scheduler | yes | - | - | Manages future task scheduling with deferred creation, overdue detection, and priority boost for past-due tasks |
| arc-self-audit | yes | - | - | Daily operational self-audit — task queue health, cost trends, skill/sensor health, recent codebase changes |
| arc-service-health | yes | - | - | System health monitor — detects stale cycles and stuck dispatch, triggers high-priority alerts |
| arc-skill-manager | yes | yes | yes | Create, inspect, and manage agent skills |
| arc-starter-publish | yes | yes | - | Detect when v2 is ahead of main and merge/push to publish |
| arc-strategy-review | yes | - | - | - |
| arc-umbrel | yes | yes | - | Bitcoin Core RPC integration and Stacks node management via local Umbrel node at 192.168.1.106 |
| arc-web-dashboard | - | yes | yes | Arc's live web dashboard — real-time task feed, sensor status, cost tracking |
| arc-workflow-review | yes | - | - | Detect repeating task patterns and propose workflow state machines — sensor creates P5 design tasks |
| arc-workflows | yes | yes | yes | Persistent state machine instances for multi-step workflows |
| arc-worktrees | - | yes | - | Opt-in git worktree isolation with experiment evaluation for dispatch tasks |
| arc0btc-ask-service | - | yes | - | Handles paid Ask Arc questions submitted via /api/ask endpoint |
| arc0btc-monetization | - | yes | - | Reviews Arc capabilities and surfaces monetizable service/product opportunities for arc0btc.com |
| arc0btc-pr-review | yes | - | - | Paid PR review service — accepts GitHub PR URLs via x402 payment and delivers structured code reviews |
| arc0btc-security-audit | yes | - | - | Paid code security audit service — accepts GitHub repo URLs via x402 payment and delivers structured security reports |
| arc0btc-site-health | yes | yes | - | Monitors arc0btc.com uptime, content freshness, API endpoints, and deployment status |
| arxiv-research | yes | yes | yes | Fetches and compiles arXiv papers on LLMs, agents, and AI into ISO-8601 research digests |
| auto-queue | yes | yes | - | Generates next task batch based on completion patterns and queue depth |
| bitcoin-quorumclaw | yes | yes | yes | Coordinate Bitcoin Taproot M-of-N multisig transactions via the QuorumClaw agent-multisig API. Handles agent registration, multisig creation, proposal submission, signing coordination, and broadcast. |
| bitcoin-taproot-multisig | - | yes | yes | Bitcoin Taproot M-of-N multisig coordination — share pubkeys, verify co-signer signatures, and navigate the OP_CHECKSIGADD workflow. |
| bitcoin-wallet | - | yes | yes | Wallet management, cryptographic signing, and STX transfers for Stacks and Bitcoin — unlock, lock, info, status, BTC/Stacks message signing, BTC signature verification, and STX sending. |
| bitflow | yes | yes | yes | Bitflow DEX swaps, liquidity provision, and pool analytics on Stacks |
| blog-deploy | yes | yes | - | Auto-deploy arc0me-site to Cloudflare Workers on content changes |
| blog-publishing | yes | yes | yes | Create, manage, and publish blog posts with ISO8601 content pattern |
| claude-code-releases | - | - | yes | Applicability research on new Claude Code releases — how each release affects Arc, AIBTC, and agents in general |
| code-audit | - | yes | - | On-demand static analysis, dependency review, and security scanning — Forge's dev quality layer |
| compliance-review | yes | - | - | Audits all skills and sensors for structural, interface, and naming compliance with Arc conventions |
| contacts | yes | yes | yes | Contact management — agents, humans, addresses, handles, relationships, interaction history |
| context-review | yes | - | - | Audits whether tasks load the right skills context at dispatch time |
| dao-zero-authority | - | yes | - | DAO proposal detection, governance participation, and voting on Stacks |
| defi-bitflow | yes | yes | - | Bitflow DEX — DCA automation, swap quotes, and high-spread signal detection |
| defi-compounding | yes | - | - | Compounding automation — harvest and reinvest DeFi yields via Bitflow LP |
| defi-stacks-market | yes | yes | yes | Prediction market trading and intelligence on stacksmarket.app — budget-enforced trading, position tracking, and signal filing. Mainnet-only. |
| defi-zest | yes | yes | - | Zest Protocol yield farming — supply, withdraw, position monitoring |
| dev-landing-page-review | - | - | yes | Full React/Next.js PR review — 77 performance rules + 10 composition rules + ~100 UI/accessibility rules for aibtcdev/landing-page PRs |
| erc8004-identity | - | yes | yes | ERC-8004 on-chain agent identity management — register agent identities, update URI and metadata, manage operator approvals, set/unset agent wallet, transfer identity NFTs, and query identity info. |
| erc8004-indexer | yes | yes | - | Index all ERC-8004 registered agents from the on-chain identity registry and publish to arc0.me/agents |
| erc8004-reputation | yes | yes | yes | ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists. |
| erc8004-trust | - | yes | - | ERC-8004 trust score aggregation — compute a composite 0-100 trust score for an agent by combining on-chain reputation feedback and validation scores. |
| erc8004-validation | - | yes | yes | ERC-8004 on-chain agent validation management — request and respond to validations, and query validation status, summaries, and paginated lists by agent or validator. |
| fleet-comms | yes | - | - | Detect agents that go silent — no dispatch or self-report for >1h |
| fleet-dashboard | yes | - | - | Aggregate fleet metrics — task counts and cost per agent — every 30 minutes |
| fleet-escalation | yes | yes | - | Detect blocked tasks on fleet agents, escalate to Arc, notify whoabuddy via email |
| fleet-handoff | - | yes | - | Route tasks between fleet agents — especially GitHub operations to Arc |
| fleet-health | yes | yes | - | Monitor agent fleet VMs — service status, dispatch age, disk usage, auth method |
| fleet-log-pull | yes | yes | - | Pull cycle logs and task stats from fleet agents via SSH |
| fleet-memory | yes | yes | - | Collect, merge, and distribute learnings across all fleet agents |
| fleet-push | - | yes | - | Change-aware code deployment — sync commits to fleet and restart only affected services |
| fleet-rebalance | yes | yes | - | Work-stealing rebalancer — moves tasks from overloaded agents to idle ones |
| fleet-router | yes | yes | - | Automated task routing from Arc to fleet agents based on domain matching |
| fleet-self-sync | yes | yes | - | Worker-local git bundle detection, apply, service restart, and health validation |
| fleet-sync | yes | yes | - | Sync CLAUDE.md, skills, and git commits across fleet agents via SSH |
| github-ci-status | yes | - | - | Monitors GitHub Actions CI runs on our PRs and detects failures |
| github-interceptor | yes | - | - | Detects blocked GitHub credential tasks on workers and auto-routes them to Arc |
| github-issue-monitor | yes | - | - | Monitors GitHub issues on managed and collaborative repos, creates triage tasks with org maintainer context |
| github-issues | yes | yes | - | GitHub issue intake for Forge — sensor detects assigned/labeled issues, CLI provides triage and code analysis workflow |
| github-mentions | yes | - | - | Detects GitHub notifications and engages as org maintainer across managed and collaborative repos |
| github-release-watcher | yes | - | - | Detects new releases on bun, claude-code, stacks-core, aibtcdev/skills and 5 other watched repos — creates P7 review tasks |
| github-security-alerts | yes | - | - | Monitor Dependabot security alerts on managed repos — P3/P4 alerts for critical/high CVEs |
| github-worker-logs | yes | yes | yes | Sync worker-logs forks, monitor production events, report trends |
| identity-guard | yes | - | - | Validates agent identity files match hostname — detects and alerts on identity drift |
| jingswap | - | yes | - | Jingswap order-book DEX on Stacks — STX/sBTC deposits, TVL checks, quotes |
| maximumsats | - | yes | yes | Nostr Web of Trust (WoT) scoring via MaximumSats API — trust scores, sybil detection, and trust paths for Nostr pubkeys. |
| maximumsats-wot | - | yes | - | Nostr Web of Trust trust scoring via MaximumSats API for pre-transaction risk assessment |
| mempool-watch | yes | - | - | Monitors Bitcoin mempool fee rates and Arc BTC address for unconfirmed incoming transactions via mempool.space API |
| quest-create | - | yes | yes | Decompose complex tasks into sequential phases with checkpoint-based idempotent execution |
| site-consistency | yes | yes | - | Cross-site consistency sensor detecting structural drift between arc0.me and arc0btc.com |
| skill-effectiveness | yes | yes | - | Track which SKILL.md versions correlate with better dispatch outcomes for data-driven prompt evolution |
| social-agent-engagement | yes | yes | - | Proactive outreach to AIBTC network agents for collaboration on shared interests |
| social-x-ecosystem | yes | - | - | Monitor X for ecosystem keywords (Bitcoin, Stacks, AIBTC, Claude Code, etc.) and file research tasks for high-signal tweets |
| social-x-posting | yes | yes | yes | Post tweets, read timeline, and manage presence on X (Twitter) via API v2 |
| stacks-stackspot | yes | yes | - | Autonomous Stacking participation — detect joinable pots, auto-join with Arc wallet, claim sBTC rewards. Mainnet-only lottery stacking. |
| styx | - | yes | yes | BTC→sBTC conversion via Styx protocol (btc2sbtc.com) — pool status, fees, deposit, and tracking |
| systems-monitor | yes | yes | - | Fleet VM system health — disk, memory, CPU load, and service status for agent nodes |
| worker-deploy | yes | yes | - | Auto-deploy arc0btc-worker to Cloudflare Workers on code changes |
| worker-logs-monitor | yes | yes | yes | Query worker-logs instances for errors, cross-reference GitHub issues, file new issues |
| zest-v2 | yes | yes | yes | Zest Protocol V2 lending, borrowing, and liquidation monitoring on Stacks |
