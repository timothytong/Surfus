// @ flow

'use strict';

import { Router }  from 'express';
import { DOMAIN_URL } from '../utils/Constants';

import User from '../models/user';
import Utils from '../utils/Utils';
import firebase from 'firebase';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;
const USERNAME_LEN_LIM = [3, 20];
const DISPLAY_NAME_LEN_LIM = [1, 30];
const PASSWORD_LEN_LIM = [6, 30];
const USER_PARAM_KEYS = [
    {
        text: 'Display Name',
        sym: 'displayName',
    },
    {
        text: 'Date of Birth',
        sym: 'dob',
    },
    {
        text: 'Email',
        sym: 'email',
    },
    {
        text: 'Password',
        sym: 'password',
    },
    {
        text: 'Username',
        sym: 'username'
    },
];

export default class UserRouter {
    // these fields must be type annotated, or Flow will complain!
    router: Router;
    path: string;

    // take the mount path as the constructor argument
    constructor(path = '/api/v1/user') {
        // instantiate the express.Router
        this.router = Router();
        this.path = path;
        // glue it all together
        this.updateProfile = this.updateProfile.bind(this);
        this.createUser = this.createUser.bind(this);
        this.startVerification = this.startVerification.bind(this);
        this.init();
    }
    /**
    * Attach route handlers to their endpoints.
    */
    init() {
        this.router.post('/create', this.createUser);
        this.router.post('/validate', this.validateUser);
        this.router.post('/login', this.loginUser);
        this.router.post('/delete', this.deleteUser);
        this.router.post('/changePassword', this.changePassword);
        this.router.post('/updateProfile', this.updateProfile);
        this.router.put('/verifyUser', this.verifyUser);
        this.router.get('/checkUserVerified', this.checkUserVerified);
        this.router.get('/logout', this.logout);
        this.router.get('/session', this.getSession);
        this.router.get('/startVerification', this.startVerification);
    }

    startVerification(req: $Request, res: $Response) {
        if (!req.session.key) {
            return res.status(401).json({
                message: 'User not logged in',
            });
        }
        const email = req.session.key.email;
        const onSuccess = () => {
            return res.status(200).json({
                message: 'Verification email sent.',
            });
        };
        const onError = (err) => {
            return res.status(500).json({
                message: 'Unexpected error occurred while starting verification process.',
                error: err,
            });
        };
        return this.startVerificationProcess(email, onSuccess, onError);
    }

    checkUserVerified(req: $Request, res: $Response) {
        if (!req.session.key) {
            return res.status(401).json({
                message: 'User not logged in',
            })
        }

        User.findOne({
            where: {
                is_active: true,
                id: req.session.key.id,
            }
        }).then((data) => {
            if (data) {
                const user = data.dataValues;
                return res.status(200).json({
                    is_verified: user.is_verified,
                });
            } else {
                return res.status(500).json({
                    message: 'Unknown error',
                });
            }
        }).catch((err) => {
            return res.status(404).json({
                message: `User ${username} does not exist`,
                error: err,
            });
        });
    }

    getSession(req: $Request, res: $Response) {
        if (!req.session.key) {
            return res.status(401).json({
                message: 'User not logged in'
            })
        }
        console.log(req.session.key['id']);
        return res.status(200).json({
            message: 'User is logged in',
            user_name: req.session.key.user_name,
            email: req.session.key.email,
        });
    }

    changePassword(req: $Request, res: $Response) {
        const { body } = req;
        const userId = req.session.key['id'];
        const password = body.password;
        const newPassword = body.newPassword;

        User.update({
            password: newPassword
        },{
            where: {
                id: userId,
                password: password,
            },
            returns: true,
        }).then((data) => {
            if (data[0] > 0) {
                return res.status(200).json({
                    message: 'Successfully changed password.',
                });
            } else {
                return res.status(500).json({
                    message: 'Unexpected error occurred while updating password',
                });
            }
        }).catch((err) => {
            console.log(err);
            return res.status(400).json({
                message: 'Unexpected error occurred while updating password',
                error: err,
            });
        });
    }

    verifyUser(req: $Request, res: $Response) {
        const { body } = req;
        const email = body.email;
        const href = body.href;

        if (firebase.auth().isSignInWithEmailLink(href)) {
            firebase.auth().signInWithEmailLink(email, href)
                .then(function(result) {
                    User.update({
                        is_verified: true,
                    },{
                        where: {
                            email,
                        },
                        returns: true,
                    }).then((data) => {
                        if (data[0] > 0) {
                            return res.status(200).json({
                                message: 'Successfully verified user.',
                            });
                        } else {
                            return res.status(500).json({
                                error: 'Error occurred while updating user verification status',
                            });
                        }
                    }).catch((err) => {
                        return res.status(500).json({
                            error: err,
                        });
                    });
                })
                .catch((err) => {
                    return res.status(500).json({
                        error: err,
                    });
                });
        } else {
            return res.status(400).json({
                error: 'Invalid verification link',
            });
        }
    }

    updateUser(editInfo, userId, successHandler, errorHandler) {
        User.update(editInfo, {
            where: {
                id: userId,
            },
            returning: true,
            plain: true,
        }).then((data) => {
            if (data[1].dataValues) {
                successHandler(data[1].dataValues);
            } else {
                errorHandler({});
            }
        }).catch((err) => {
            errorHandler(err);
        });
    }

    updateProfile(req: $Request, res: $Response) {
        const { body } = req;
        const userId = req.session.key['id'];
        const email = body.email;
        const username = body.userName;
        const onSuccessHandler = (data) => {
            req.session.key = data;
            return res.status(200).json({
                message: 'Successfully updated profile.',
            });
        }
        const onErrorHandler = (err) => {
            return res.status(500).json({
                message: 'Unexpected error while updating profile',
                error: err,
            });
        }
        const editInfo = {};

        if (email) {
            const errorMessage = getErrorMessageIfEmailIsInvalid(email);
            if (errorMessage) {
                return res.status(400).json({
                    message: errorMessage,
                });
            }
            editInfo.email = email;
        }

        if (username) {
            return checkUserNameExists(username).then((data) => {
                if (data) {
                    return res.status(400).json({
                        message: 'Username unavailable.',
                        error: err.message,
                    });
                } else {
                    editInfo.user_name = username;
                    return this.updateUser(editInfo, userId, onSuccessHandler, onErrorHandler);
                }
            }).catch((err) => {
                return res.status(400).json({
                    message: 'Unexpected error while updating profile',
                    error: err,
                });
            });
        }

        return this.updateUser(editInfo, userId, onSuccessHandler, onErrorHandler);

    }

    loginUser(req: $Request, res: $Response) {
        const { body } = req;
        const username = body.username;
        const password = body.password;

        User.findOne({
            where: {
                user_name: username,
                is_active: true,
            }
        }).then((data) => {
            if (data) {
                const user = data.dataValues;
                bcrypt.compare(password, user.password, (err, correct) => {
                    if (!err && correct) {
                        req.session.key = data.dataValues;
                        return res.status(200).json({
                            message: 'Login successful.',
                        });
                    }
                    return res.status(400).json({
                        message: 'Invalid username or password',
                    });
                });
            } else {
                return res.status(500).json({
                    message: 'Unknown error',
                    error: err,
                });
            }
        }).catch((err) => {
            return res.status(404).json({
                message: `User ${username} does not exist`,
                error: err,
            });
        });
    }

    logout(req: $Request, res: $Response) {
        if (req.session.key) {
            delete req.session.key;
            return res.status(200).json({
                message: 'Successfully logged out.',
            });
        } else {
            return res.status(401).json({
                message: 'User not authenticated.'
            })
        }
    }

    deleteUser(req: $Request, res: $Response) {
        const { body } = req;

        if (req.session.key) {
            const userId = req.session.key['id'];
            User.update({
                is_active: false,
            },{
                where: {
                    id: userId,
                },
                returns: true,
            }).then((data) => {
                if (data[0] > 0) {
                    delete req.session.key;
                    return res.status(200).json({
                        message: 'Successfully deleted user.',
                    });
                } else {
                    return res.status(500).json({
                        message: 'Unknown error while deleting user',
                    });
                }
            }).catch((err) => {
                return res.status(500).json({
                    message: 'Error occurred while deleting user',
                    error: err,
                });
            });
        } else {
            return res.status(401).json({
                message: 'User not authenticated.'
            })
        }
    }

    validateUser(req: $Request, res: $Response) {
        const { body } = req;
        const username = body.userName;

        checkUsernameExists(username).then((data) => {
            if (data) {
                return res.status(400).json({
                    message: `Username ${username} has already been taken.`,
                });
            } else {
                return res.status(200).json({
                    message: 'Username available.',
                });
            }
        }).catch((err) => {
            console.log(err);
            return res.status(500).json({
                message: 'Unexpected error occurred while validating username',
                error: err,
            });
        });
    }

    startVerificationProcess(email, successHandler, errorHandler) {
        console.log("Processing email " + email + ", REDIRECTING TO: " + DOMAIN_URL + "/verifyUser");
        const actionCodeSettings = {
            url: `${DOMAIN_URL}/verifyUser`,
            // This must be true.
            handleCodeInApp: true,
        };
        firebase.auth().sendSignInLinkToEmail(email, actionCodeSettings)
            .then(() => successHandler())
            .catch((err) => {
                console.log('FIREBASE ERROR: ');
                console.log(err);
                errorHandler(err);
            });
    }

    createUser(req: $Request, res: $Response) {
        let errorMessage = Utils.getErrorMessageIfNullFieldExists(req.body, USER_PARAM_KEYS);
        if (errorMessage) {
            return res.status(400).json({
                message: errorMessage,
            });
        }

        const { username, displayName, email, dob, password } = req.body;

        errorMessage = Utils.getErrorMessageIfInvalidStringLength(username, 'Username', USERNAME_LEN_LIM) ||
                       getErrorMessageIfUsernameIsInvalid(username, 'Username') ||
                       Utils.getErrorMessageIfInvalidStringLength(displayName, 'Display name', DISPLAY_NAME_LEN_LIM) ||
                       getErrorMessageIfUsernameIsInvalid(displayName, 'Display name') ||
                       Utils.getErrorMessageIfInvalidStringLength(password, 'Password', PASSWORD_LEN_LIM);

        if (errorMessage) {
            return res.status(400).json({
                message: errorMessage,
            });
        }

        bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
            if (err) {
                return res.status(500).json({
                    message: 'Unable to hash password',
                    error: err,
                });
            }

            checkUsernameExists(username).then((data) => {
                if (data) {
                    return res.status(400).json({
                        message: `Username ${username} has already been taken.`,
                    });
                } else {
                    User.create({
                        display_name: displayName,
                        dob,
                        email,
                        is_active: true,
                        is_verified: false,
                        password: hash,
                        user_name: username,
                    }).then(() => {
                        const onSuccess = () => {
                            return res.status(200).json({
                                message: 'User created.',
                            });
                        };
                        const onError = (err) => {
                            return res.status(500).json({
                                message: 'Internal error, please log in to begin verification process.',
                                error: err,
                            });
                        };
                        this.startVerificationProcess(email, onSuccess, onError);
                    }).catch((err) => {
                        return res.status(400).json({
                            message: 'Unable to create user.',
                            error: err,
                        });
                    })
                }
            }).catch((err) => {
                return res.status(500).json({
                    message: 'Unexpected error occurred while creating user.',
                    error: err,
                });
            })
        });
    }
}

function checkUsernameExists (username) {
    return User.findOne({
        where: {
            user_name: username,
            is_active: true,
        }
    });
}


function getErrorMessageIfEmailIsInvalid(email) {
    const emailRegex = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;
    if (!email.match(emailRegex)) {
        return 'Invalid email format.';
    }
    return null;
}

function getErrorMessageIfUsernameIsInvalid(username, fieldName) {
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!username.match(usernameRegex)) {
        return `Invalid ${fieldName} characters. (letters, numbers, ".", and "_" only`;
    }
    return null;
}

