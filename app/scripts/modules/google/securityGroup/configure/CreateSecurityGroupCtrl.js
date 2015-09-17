'use strict';

let angular = require('angular');

module.exports = angular.module('spinnaker.gce.securityGroup.create.controller', [
  require('angular-ui-router'),
  require('../../../account/account.service.js'),
  require('../../../caches/infrastructureCaches.js'),
  require('../../../caches/cacheInitializer.js'),
  require('../../../tasks/monitor/taskMonitorService.js'),
  require('../../../securityGroups/securityGroup.read.service.js'),
])
  .controller('gceCreateSecurityGroupCtrl', function($scope, $modalInstance, $state, $controller,
                                                  accountService, securityGroupReader,
                                                  taskMonitorService, cacheInitializer, infrastructureCaches,
                                                  _, application, securityGroup ) {

    $scope.pages = {
      location: require('./createSecurityGroupProperties.html'),
      ingress: require('./createSecurityGroupIngress.html'),
    };

    var ctrl = this;

    angular.extend(this, $controller('gceConfigSecurityGroupMixin', {
      $scope: $scope,
      $modalInstance: $modalInstance,
      application: application,
      securityGroup: securityGroup,
    }));


    accountService.listAccounts('gce').then(function(accounts) {
      $scope.accounts = accounts;
      ctrl.accountUpdated();
    });

    this.getSecurityGroupRefreshTime = function() {
      return infrastructureCaches.securityGroups.getStats().ageMax;
    };


    ctrl.upsert = function () {
      ctrl.mixinUpsert('Create');
    };

    ctrl.initializeSecurityGroups();

  }).name;