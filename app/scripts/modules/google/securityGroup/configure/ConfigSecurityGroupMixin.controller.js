'use strict';

var angular = require('angular');

module.exports = angular
  .module('spinnaker.google.securityGroup.baseConfig.controller', [
    require('angular-ui-router'),
    require('../../../tasks/monitor/taskMonitorService.js'),
    require('../../../securityGroups/securityGroup.write.service.js'),
    require('../../../account/account.service.js'),
    require('../../../modal/wizard/modalWizard.directive.js'),
    require('../../../utils/lodash.js'),
  ])
  .controller('gceConfigSecurityGroupMixin', function ($scope,
                                                             $state,
                                                             $modalInstance,
                                                             taskMonitorService,
                                                             application,
                                                             securityGroup,
                                                             securityGroupReader,
                                                             securityGroupWriter,
                                                             accountService,
                                                             modalWizardService,
                                                             cacheInitializer,
                                                             _ ) {



    var ctrl = this;

    $scope.isNew = true;

    $scope.state = {
      submitting: false,
      refreshingSecurityGroups: false,
      removedRules: [],
      infiniteScroll: {
        numToAdd: 20,
        currentItems: 20,
      },
    };

    ctrl.addMoreItems = function() {
      $scope.state.infiniteScroll.currentItems += $scope.state.infiniteScroll.numToAdd;
    };

    $scope.taskMonitor = taskMonitorService.buildTaskMonitor({
      application: application,
      title: 'Creating your security group',
      forceRefreshMessage: 'Getting your new security group from Amazon...',
      modalInstance: $modalInstance,
      forceRefreshEnabled: true
    });

    $scope.securityGroup = securityGroup;

    $scope.taskMonitor.onApplicationRefresh = function handleApplicationRefreshComplete() {
      $modalInstance.close();
      var newStateParams = {
        name: $scope.securityGroup.name,
        accountId: $scope.securityGroup.credentials || $scope.securityGroup.accountName,
        region: $scope.securityGroup.region,
        provider: 'aws',
      };
      if (!$state.includes('**.securityGroupDetails')) {
        $state.go('.securityGroupDetails', newStateParams);
      } else {
        $state.go('^.securityGroupDetails', newStateParams);
      }
    };

    ctrl.upsert = function () {
      $scope.taskMonitor.submit(
        function() {
          return securityGroupWriter.upsertSecurityGroup($scope.securityGroup, application, 'Create');
        }
      );
    };

    function configureFilteredSecurityGroups() {
      var existingSecurityGroupNames = [];
      var availableSecurityGroups = [];

      $scope.availableSecurityGroups = availableSecurityGroups;
      $scope.existingSecurityGroupNames = existingSecurityGroupNames;
      clearInvalidSecurityGroups();
    }

    ctrl.mixinUpsert = function (descriptor) {
      $scope.taskMonitor.submit(
        function() {
          return securityGroupWriter.upsertSecurityGroup($scope.securityGroup, application, descriptor);
        }
      );
    };

    ctrl.accountUpdated = configureFilteredSecurityGroups;

    function clearInvalidSecurityGroups() {
      var removed = $scope.state.removedRules;
      $scope.securityGroup.securityGroupIngress = $scope.securityGroup.securityGroupIngress.filter(function(rule) {
        if (rule.name && $scope.availableSecurityGroups.indexOf(rule.name) === -1) {
          removed.push(rule.name);
          return false;
        }
        return true;
      });
      if (removed.length) {
        modalWizardService.getWizard().markDirty('Ingress');
      }
    }

    ctrl.refreshSecurityGroups = function() {
      $scope.state.refreshingSecurityGroups = true;
      return cacheInitializer.refreshCache('securityGroups').then(function() {
        return ctrl.initializeSecurityGroups().then(function() {
          $scope.state.refreshingSecurityGroups = false;
        });
      });
    };

    var allSecurityGroups = {};

    ctrl.initializeSecurityGroups = function() {
      return securityGroupReader.getAllSecurityGroups().then(function (securityGroups) {
        allSecurityGroups = securityGroups;
        var account = $scope.securityGroup.credentials || $scope.securityGroup.accountName;

        var availableGroups;
        if(account) {
          availableGroups = securityGroups[account].gce.global;
        } else {
          availableGroups = securityGroups;
        }

        $scope.availableSecurityGroups = _.pluck(availableGroups, 'name');
      });
    };

    ctrl.cancel = function () {
      $modalInstance.dismiss();
    };

    ctrl.getCurrentNamePattern = function() {
      return /.+/;
    };

    ctrl.updateName = function() {
      var securityGroup = $scope.securityGroup,
        name = application.name;
      if (securityGroup.detail) {
        name += '-' + securityGroup.detail;
      }
      securityGroup.name = name;
      $scope.namePreview = name;
    };

    ctrl.namePattern = {
      test: function(name) {
        return ctrl.getCurrentNamePattern().test(name);
      }
    };

    ctrl.addRule = function(ruleset) {
      ruleset.push({
        type: 'tcp',
        startPort: 7001,
        endPort: 7001,
      });
    };

    ctrl.removeRule = function(ruleset, index) {
      ruleset.splice(index, 1);
    };


  })
  .name;
