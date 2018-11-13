'use strict';

import CommissionFormDb from '../commisionForm/CommissionFormDb';
import UserDb from './UserDb';

// define DB relationships
UserDb.hasMany(CommissionFormDb, {
    foreignKey: 'comm_form_id',
    targetKey: 'id',
});

export default {
    userDb: UserDb,
}
