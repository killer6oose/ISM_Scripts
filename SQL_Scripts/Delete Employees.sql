Delete from [dbo].[Employee] WHERE LoginId NOT IN
	('frs.tso'
	,'frs.pso'
	,'discovery.manager'
	,'discovery.analyst'
	,'ipcm'
	,'Admin'
	,'frs.admin'
	,'Self.Service'
	,'InternalServices'
	,'{YOUR_LOGINID}')
