import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as rds from "@aws-cdk/aws-rds";
import * as ssm from '@aws-cdk/aws-ssm';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';
import secretsManager = require('@aws-cdk/aws-secretsmanager');
import { Peer } from '@aws-cdk/aws-ec2';

export class GoApiStackStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dbName = 'todolist';
    const dbUserName = 'postgres'

    const dbCredentials = new secretsManager.Secret(this, 'dbCredentials', {
      secretName: `${dbName}-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: dbUserName,
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    new ssm.StringParameter(this, 'dbCredentialsArn', {
      parameterName: `${dbName}-credentials-arn`,
      stringValue: dbCredentials.secretArn,
    });
    
    const vpc = new ec2.Vpc(this, 'vpc', {
      maxAzs: 2,
      cidr: '10.0.0.0/16'
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'dbSecurityGroup', { vpc });
    dbSecurityGroup.addIngressRule(ec2.Peer.ipv4('10.0.0.0/16'), ec2.Port.tcp(5432));

    const postgresDb = new rds.DatabaseInstance(this, "postgresDb", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_10_7
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE
      },
      databaseName: dbName,
      credentials: rds.Credentials.fromSecret(dbCredentials)
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {vpc});

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "ecs-logs"
    });

    const taskRole = new iam.Role(this, `ecs-taskRole-${this.stackName}`, {
      roleName: `ecs-taskRole-${this.stackName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    const executionRolePolicy =  new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ]
    });

    const taskDef = new ecs.FargateTaskDefinition(this, "ecs-taskdef", {
      taskRole: taskRole
    });

    taskDef.addToExecutionRolePolicy(executionRolePolicy);

    const container = taskDef.addContainer('go-spa', {
      image: ecs.ContainerImage.fromRegistry("961083941605.dkr.ecr.ap-southeast-2.amazonaws.com/techchallengeapp"),
      memoryLimitMiB: 256,
      cpu: 256,
      logging,
      entryPoint: ["./TechChallengeApp","serve"],
      //command: ["./TechChallengeApp","updatedb","-s"],
      environment: {
        VTT_DBUSER: dbCredentials.secretValueFromJson('username').toString(),
        VTT_DBNAME: dbName,
        VTT_DBPASSWORD: dbCredentials.secretValueFromJson('password').toString(),
        VTT_DBHOST: postgresDb.dbInstanceEndpointAddress
      }
    });

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP
    });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "ecs-service", {
      cluster: cluster,
      taskDefinition: taskDef,
      publicLoadBalancer: true,
      desiredCount: 2,
      listenerPort: 80
    });
  }
}
