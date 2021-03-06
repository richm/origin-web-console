'use strict';

/**
 * @ngdoc function
 * @name openshiftConsole.controller:DeploymentsController
 * @description
 * # ProjectController
 * Controller of the openshiftConsole
 */
angular.module('openshiftConsole')
  .controller('DeploymentsController', function ($scope,
                                                 $filter,
                                                 $routeParams,
                                                 AlertMessageService,
                                                 DataService,
                                                 DeploymentsService,
                                                 LabelFilter,
                                                 Logger,
                                                 ProjectsService) {
    $scope.projectName = $routeParams.project;
    $scope.replicationControllers = {};
    $scope.unfilteredDeploymentConfigs = {};
    $scope.unfilteredDeployments = {};
    $scope.replicationControllersByDC = {};
    $scope.labelSuggestions = {};
    $scope.alerts = $scope.alerts || {};
    $scope.emptyMessage = "Loading...";
    $scope.expandedDeploymentConfigRow = {};
    $scope.unfilteredReplicaSets = {};
    $scope.unfilteredReplicationControllers = {};

    // get and clear any alerts
    AlertMessageService.getAlerts().forEach(function(alert) {
      $scope.alerts[alert.name] = alert.data;
    });
    AlertMessageService.clearAlerts();

    var watches = [];
    ProjectsService
      .get($routeParams.project)
      .then(_.spread(function(project, context) {
        $scope.project = project;
        watches.push(DataService.watch("replicationcontrollers", context, function(replicationControllers, action, replicationController) {
          $scope.replicationControllers = replicationControllers.by("metadata.name");

          var dcName, rcName;
          if (replicationController) {
            dcName = $filter('annotation')(replicationController, 'deploymentConfig');
            rcName = replicationController.metadata.name;
          }

          $scope.replicationControllersByDC = DeploymentsService.associateDeploymentsToDeploymentConfig($scope.replicationControllers, $scope.deploymentConfigs, true);
          if ($scope.replicationControllersByDC['']) {
            $scope.unfilteredReplicationControllers = $scope.replicationControllersByDC[''];
            LabelFilter.addLabelSuggestionsFromResources($scope.unfilteredReplicationControllers, $scope.labelSuggestions);
            LabelFilter.setLabelSuggestions($scope.labelSuggestions);
            $scope.replicationControllersByDC[''] = LabelFilter.getLabelSelector().select($scope.replicationControllersByDC['']);
          }
          updateFilterWarning();

          if (!action) {
            // Loading of the page that will create deploymentConfigDeploymentsInProgress structure, which will associate running deployment to his deploymentConfig.
            $scope.deploymentConfigDeploymentsInProgress = DeploymentsService.associateRunningDeploymentToDeploymentConfig($scope.replicationControllersByDC);
          } else if (action === 'ADDED' || (action === 'MODIFIED' && ['New', 'Pending', 'Running'].indexOf($filter('deploymentStatus')(replicationController)) > -1)) {
            // When new deployment id instantiated/cloned, or in case of a retry, associate him to his deploymentConfig and add him into deploymentConfigDeploymentsInProgress structure.
            $scope.deploymentConfigDeploymentsInProgress[dcName] = $scope.deploymentConfigDeploymentsInProgress[dcName] || {};
            $scope.deploymentConfigDeploymentsInProgress[dcName][rcName] = replicationController;
          } else if (action === 'MODIFIED') {
            // After the deployment ends remove him from the deploymentConfigDeploymentsInProgress structure.
            var status = $filter('deploymentStatus')(replicationController);
            if (status === "Complete" || status === "Failed"){
              delete $scope.deploymentConfigDeploymentsInProgress[dcName][rcName];
            }
          }

          // Extract the causes from the encoded deployment config
          if (replicationController) {
            if (action !== "DELETED") {
              replicationController.causes = $filter('deploymentCauses')(replicationController);
            }
          }
          else {
            angular.forEach($scope.replicationControllers, function(replicationController) {
              replicationController.causes = $filter('deploymentCauses')(replicationController);
            });
          }

          Logger.log("replicationControllers (subscribe)", $scope.replicationControllers);
        }));

        watches.push(DataService.watch({
          group: "extensions",
          resource: "replicasets"
        }, context, function(replicaSets) {
          // TODO: This should be updated to only include replica sets that do not have a deployment.
          $scope.unfilteredReplicaSets = replicaSets.by("metadata.name");
          LabelFilter.addLabelSuggestionsFromResources($scope.unfilteredReplicaSets, $scope.labelSuggestions);
          LabelFilter.setLabelSuggestions($scope.labelSuggestions);
          $scope.replicaSets = LabelFilter.getLabelSelector().select($scope.unfilteredReplicaSets);
          Logger.log("replicasets (subscribe)", $scope.replicaSets);
        }));

        watches.push(DataService.watch("deploymentconfigs", context, function(deploymentConfigs) {
          $scope.unfilteredDeploymentConfigs = deploymentConfigs.by("metadata.name");
          LabelFilter.addLabelSuggestionsFromResources($scope.unfilteredDeploymentConfigs, $scope.labelSuggestions);
          LabelFilter.setLabelSuggestions($scope.labelSuggestions);
          $scope.deploymentConfigs = LabelFilter.getLabelSelector().select($scope.unfilteredDeploymentConfigs);
          $scope.emptyMessage = "No deployment configurations to show";
          $scope.replicationControllersByDC = DeploymentsService.associateDeploymentsToDeploymentConfig($scope.replicationControllers, $scope.deploymentConfigs, true);
          if ($scope.replicationControllersByDC['']) {
            $scope.unfilteredReplicationControllers = $scope.replicationControllersByDC[''];
            $scope.replicationControllersByDC[''] = LabelFilter.getLabelSelector().select($scope.replicationControllersByDC['']);
          }
          updateFilterWarning();
          Logger.log("deploymentconfigs (subscribe)", $scope.deploymentConfigs);
        }));

        watches.push(DataService.watch({
          group: "extensions",
          resource: "deployments"
        }, context, function(deployments) {
          $scope.unfilteredDeployments = deployments.by("metadata.name");
          LabelFilter.addLabelSuggestionsFromResources($scope.unfilteredDeployments, $scope.labelSuggestions);
          LabelFilter.setLabelSuggestions($scope.labelSuggestions);
          $scope.deployments = LabelFilter.getLabelSelector().select($scope.unfilteredDeployments);
          Logger.log("deployments (subscribe)", $scope.unfilteredDeployments);
        }));

        function updateFilterWarning() {
          var isFiltering = !LabelFilter.getLabelSelector().isEmpty();
          if (!isFiltering) {
            delete $scope.alerts["deployments"];
            return;
          }

          var unfilteredDeploymentsEmpty =
            _.isEmpty($scope.unfilteredDeploymentConfigs) &&
            _.isEmpty($scope.unfilteredReplicationControllers) &&
            _.isEmpty($scope.unfilteredDeployments) &&
            _.isEmpty($scope.unfilteredReplicaSets);
          if (unfilteredDeploymentsEmpty) {
            delete $scope.alerts["deployments"];
            return;
          }

          var filteredDeploymentsEmpty =
            _.isEmpty($scope.deploymentConfigs) &&
            _.isEmpty($scope.replicationControllersByDC['']) &&
            _.isEmpty($scope.deployments) &&
            _.isEmpty($scope.replicaSets);
          if (!filteredDeploymentsEmpty) {
            delete $scope.alerts["deployments"];
            return;
          }

          $scope.alerts["deployments"] = {
            type: "warning",
            details: "The active filters are hiding all deployments."
          };
        }

        $scope.showEmptyMessage = function() {
          if ($filter('hashSize')($scope.replicationControllersByDC) === 0) {
            return true;
          }

          if ($filter('hashSize')($scope.replicationControllersByDC) === 1 && $scope.replicationControllersByDC['']) {
            return true;
          }

          return false;
        };

        LabelFilter.onActiveFiltersChanged(function(labelSelector) {
          // trigger a digest loop
          $scope.$apply(function() {
            $scope.deploymentConfigs = labelSelector.select($scope.unfilteredDeploymentConfigs);
            $scope.replicationControllersByDC = DeploymentsService.associateDeploymentsToDeploymentConfig($scope.replicationControllers, $scope.deploymentConfigs, true);
            if ($scope.replicationControllersByDC['']) {
              $scope.unfilteredReplicationControllers = $scope.replicationControllersByDC[''];
              $scope.replicationControllersByDC[''] = LabelFilter.getLabelSelector().select($scope.replicationControllersByDC['']);
            }
            $scope.deployments = labelSelector.select($scope.unfilteredDeployments);
            $scope.replicaSets = labelSelector.select($scope.unfilteredReplicaSets);
            updateFilterWarning();
          });
        });

        $scope.$on('$destroy', function(){
          DataService.unwatchAll(watches);
        });
      }));
  });
